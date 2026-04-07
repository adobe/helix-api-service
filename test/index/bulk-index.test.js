/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
import assert from 'assert';
import sinon from 'sinon';
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { main } from '../../src/index.js';
import { IndexMessages } from '../../src/index/IndexMessages.js';
import { Nock, SITE_CONFIG } from '../utils.js';

/**
 * Content bus ID (short form)
 */
const CONTENT_BUS_ID = SITE_CONFIG.content.contentBusId;

/**
 * Index configuration
 */
const INDEX_CONFIG = `
indices:
  default: &default
    include:
    - '/en/**'
    target: /en/query-index.json
    properties:
      title:
        select: head > meta[property="og:title"]
        value: |
          attribute(el, 'content')
      lastModified:
        select: none
        value: |
          parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')
  french:
    <<: *default
    include:
    - '/fr/**'
    target: /fr/query-index.json
  no-target: &bad-definition
    properties:
      lastModified:
        select: none
        value: |
          parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')
  not-relative:
    <<: *bad-definition
    target: not-relative/query-index.json
`;

describe('Bulk Index Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  /** @type {object[]} */
  let updates;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
    nock.indexConfig(INDEX_CONFIG);
    nock.sitemapConfig(`
sitemaps:
  default:
    source: /sitemap-index.json
    destination: /sitemap.xml`);

    sandbox = sinon.createSandbox();
    sandbox.stub(IndexMessages.prototype, 'send').callsFake(function fn() {
      updates = this.messages.map(({ MessageBody }) => {
        const { record: { path }, deleted } = JSON.parse(MessageBody);
        const ret = { path };
        if (deleted) {
          ret.deleted = true;
        }
        return ret;
      }).sort((a, b) => a.path.localeCompare(b.path));
    });
  });

  afterEach(() => {
    updates = null;
    sandbox.restore();
    nock.done();
  });

  function setupTest(paths = ['/*'], indexNames = []) {
    const suffix = '/org/sites/site/index/*';

    const request = new Request(`https://api.aem.live${suffix}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'rid',
      },
      body: JSON.stringify({ paths, indexNames }),
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        maximumNumPaths: 100,
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
        HELIX_STORAGE_DISABLE_R2: 'true',
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
      },
      runtime: { region: 'us-east-1', accountId: 'account-id' },
      func: { fqn: 'helix-api-service', version: '1.0.0' },
      invocation: { id: 'invocation-id' },
    };
    return { request, context };
  }

  it('return 400 when `paths` is empty', async () => {
    const { request, context } = setupTest([]);
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'bulk-index payload is missing \'paths\'',
    });
  });

  it('return 400 when `paths` is not an array', async () => {
    const { request, context } = setupTest({});
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'bulk-index \'paths\' is not an array',
    });
  });

  it('return 400 when `indexNames` is not an array', async () => {
    const { request, context } = setupTest(['/*'], {});
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'bulk-index \'indexNames\' is not an array',
    });
  });

  it('return 400 when some path is illegal', async () => {
    const { request, context } = setupTest(['/-parent/']);
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'bulk-index path not valid: /-parent/',
    });
  });

  it('return 400 when some path is a config resource', async () => {
    const { request, context } = setupTest(['/.helix/config.json']);
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'bulk-index of config resources is not supported: /.helix/config.json',
    });
  });

  it('reindex everything', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, { data: [{ path: '/en/' }] })
      .getObject('/live/fr/query-index.json')
      .reply(404);
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/live/`, [
      { Key: 'en/index.md' },
      { Key: 'fr/index.md' },
    ], '');
    nock('https://main--site--org.aem.live')
      .get('/en/')
      .reply(200, '<html></html>', { 'last-modified': 'Tue, 04 May 2021 04:40:15 GMT' })
      .get('/fr/')
      .reply(200, '<html></html>', { 'last-modified': 'Tue, 04 May 2021 04:40:15 GMT' });

    const { request, context } = setupTest();
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(updates, [{ path: '/en/' }, { path: '/fr/' }]);
  });

  it('reindex a subtree in an index', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, { data: [{ path: '/en/gone' }] });
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/live/en/`, [
      { Key: 'index.md' },
    ], '');
    nock('https://main--site--org.aem.live')
      .get('/en/')
      .reply(200, '<html></html>', { 'last-modified': 'Tue, 04 May 2021 04:40:15 GMT' });

    const { request, context } = setupTest(['/en/*'], ['default']);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(updates, [
      { path: '/en/' },
      { path: '/en/gone', deleted: true },
    ]);
  });

  it('reindex specific paths in an index', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, { data: [{ path: '/en/gone' }] });
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/live/`, [
      { Key: 'en/index.md' },
    ], '');
    nock('https://main--site--org.aem.live')
      .get('/en/')
      .reply(200, '<html></html>', { 'last-modified': 'Tue, 04 May 2021 04:40:15 GMT' })
      .get('/en/gone')
      .reply(404);

    const { request, context } = setupTest(['/en/', '/en/gone'], ['default']);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(updates, [
      { path: '/en/' },
      { path: '/en/gone', deleted: true },
    ]);
  });

  it('ignores a page that has not changed', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, { data: [{ title: '', path: '/en/', lastModified: 1620103215 }] });
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/live/`, [
      { Key: 'en/index.md' },
    ], '');
    nock('https://main--site--org.aem.live')
      .get('/en/')
      .reply(200, '<html></html>', { 'last-modified': 'Tue, 04 May 2021 04:40:15 GMT' });

    const { request, context } = setupTest(['/en/'], ['default']);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
  });

  it('reports an error if fetching a page fails', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, { data: {} });
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/live/`, [
      { Key: 'en/index.md' },
    ], '');
    nock('https://main--site--org.aem.live')
      .get('/en/')
      .reply(500);

    const { request, context } = setupTest(['/en/'], ['default']);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
  });

  it('reports an error when too many paths are found', async () => {
    nock.listObjects(
      'helix-content-bus',
      `${CONTENT_BUS_ID}/live/en/`,
      Array.from({ length: 101 }, (_, index) => ({ Key: `document-${index + 1}` })),
      '',
    );

    const { request, context } = setupTest(['/en/*'], ['default']);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    const { job } = await response.json();
    assert.strictEqual(job.error, 'Too many paths with prefix \'/en/\': 101, maximum allowed is: 100');
  });
});
