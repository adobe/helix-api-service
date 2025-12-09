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
import { AuthInfo } from '../../src/auth/auth-info.js';
import { REDIRECTS_JSON_PATH } from '../../src/contentbus/contentbus.js';
import { HANDLERS } from '../../src/lookup/web2edit.js';
import { main } from '../../src/index.js';
import { INTERNAL_SITEMAP_INDEX } from '../../src/index/utils.js';
import purge from '../../src/cache/purge.js';
import { Nock, SITE_CONFIG } from '../utils.js';

describe('Publish Remove Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  /** @type {import('../../src/lookup/lookup.js').LookupHandler} */
  let web2edit;

  /** @type {object[]} */
  const entries = [];

  /** @type {import('../../src/cache/purge.js').PurgeInfo[]} */
  let purgeInfos;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
    web2edit = HANDLERS[SITE_CONFIG.content.source.type];

    sandbox.stub(purge, 'perform').callsFake((context, info, infos) => {
      purgeInfos = infos;
    });

    nock.siteConfig(SITE_CONFIG);
  });

  afterEach(() => {
    entries.length = 0;

    sandbox.restore();
    nock.done();
  });

  function setupTest(path = '/', { data, redirects } = {}) {
    const suffix = `/org/sites/site/live${path}`;
    const query = new URLSearchParams(data);

    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      method: 'DELETE',
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        redirects: { live: redirects ?? [] },
      },
      runtime: { region: 'us-east-1' },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
        HLX_FASTLY_PURGE_TOKEN: 'token',
        HELIX_STORAGE_DISABLE_R2: 'true',
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
      },
    };
    return { request, context };
  }

  describe('regular operation', () => {
    beforeEach(() => {
      nock.indexConfig(null);
      nock.sitemapConfig(null);
      nock.sqs('helix-indexer', entries);
      nock.content()
        .head('/live/sitemap.json')
        .reply(200)
        .getObject('/live/sitemap.json')
        .reply(200, []);
    });

    it('remove document', async () => {
      sandbox.stub(web2edit, 'lookup')
        .returns({ status: 404 });

      nock.content()
        .head('/live/index.md')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
        .deleteObject('/live/index.md')
        .reply(204);

      const { request, context } = setupTest('/');
      const response = await main(request, context);

      assert.strictEqual(response.status, 204);
      assert.deepStrictEqual(purgeInfos, [
        { path: '/' },
        { path: '/index.plain.html' },
        { key: 'DiyvKbkf2MaZORJJ' },
        { key: '8lnjgOWBwsoqAQXB' },
      ]);
      assert.deepStrictEqual(entries, [{
        MessageAttributes: {
          owner: { DataType: 'String', StringValue: 'org' },
          repo: { DataType: 'String', StringValue: 'site' },
        },
        MessageBody: {
          owner: 'org',
          repo: 'site',
          index: INTERNAL_SITEMAP_INDEX,
          record: {
            path: '/',
          },
          type: 'markup',
          deleted: true,
        },
      }]);
    });
  });

  describe('operation fails', () => {
    it('fails to remove document when source exists', async () => {
      sandbox.stub(web2edit, 'lookup')
        .returns({ editUrl: 'yep, still here!' });

      const { request, context } = setupTest('/');
      const response = await main(request, context);

      assert.strictEqual(response.status, 403);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'delete not allowed while source exists.',
      });
    });

    it('fails to remove document when `web2edit` reports an error', async () => {
      sandbox.stub(web2edit, 'lookup')
        .returns({
          status: 403,
          error: 'Access denied',
        });

      const { request, context } = setupTest('/');
      const response = await main(request, context);

      assert.strictEqual(response.status, 403);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'Access denied',
      });
    });

    it('remove redirects', async () => {
      sandbox.stub(web2edit, 'lookup')
        .returns({ status: 404 });

      nock.content()
        .deleteObject('/live/redirects.json')
        .reply(204);

      const { request, context } = setupTest(REDIRECTS_JSON_PATH);
      const response = await main(request, context);

      assert.strictEqual(response.status, 204);
      assert.deepStrictEqual(purgeInfos, [
        { key: 'DmtUcbOVSbg9dZSu' },
        { key: 'x2iMHA9EUgMOMASW' },
        { path: '/redirects.json' },
      ]);
    });

    it('reports an error when `contentBusRemove` returns 500', async () => {
      sandbox.stub(web2edit, 'lookup')
        .returns({ status: 404 });

      nock.content()
        .head('/live/index.md')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
        .deleteObject('/live/index.md')
        .reply(500);

      const { request, context } = setupTest('/');
      const response = await main(request, context);

      assert.strictEqual(response.status, 502);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': `removing helix-content-bus/${SITE_CONFIG.content.contentBusId}/live/index.md from storage failed: [S3] UnknownError`,
      });
    });

    it('`forward a 404 status from `contentBusRemove``', async () => {
      sandbox.stub(web2edit, 'lookup')
        .returns({ status: 404 });

      nock.content()
        .head('/live/index.md')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
        .deleteObject('/live/index.md')
        .reply(404);

      const { request, context } = setupTest('/');
      const response = await main(request, context);

      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': `removing helix-content-bus/${SITE_CONFIG.content.contentBusId}/live/index.md from storage failed: [S3] Unknown`,
      });
    });
  });
});
