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
import { resolve } from 'path';
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';

const INDEX_CONFIG = `
indices:
  default:
    target: /query-index.json
    properties:
      title:
        select: head > meta[property="og:title"]
        value: |
          attribute(el, 'content')
      lastModified:
        select: none
        value: |
          parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')
`;

describe('Index Update Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {object[]} */
  const entries = [];

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
    nock.indexConfig(INDEX_CONFIG);
    nock.sitemapConfig(null);
    nock.sqs('helix-indexer', entries);
    nock.content()
      .head('/live/sitemap.json')
      .reply(404)
      .head('/live/document.md')
      .reply(200, '', { 'x-amz-meta-x-source-last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' });
  });

  afterEach(() => {
    entries.length = 0;
    nock.done();
  });

  function setupTest(path = '/') {
    const suffix = `/org/sites/site/index${path}`;

    const request = new Request(`https://localhost${suffix}`, {
      method: 'POST',
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        retryDelay: 1,
      },
      runtime: {
        accountId: '123456789012',
        region: 'us-east-1',
      },
      env: {
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    };
    return { request, context };
  }

  it('updates indexed resource', async () => {
    nock('https://main--site--org.aem.live')
      .get('/document')
      .replyWithFile(
        200,
        resolve(__testdir, 'index', 'fixtures', 'document.html'),
        { 'last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' },
      );

    const { request, context } = setupTest('/document');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(entries, [{
      MessageAttributes: {
        owner: { DataType: 'String', StringValue: 'org' },
        repo: { DataType: 'String', StringValue: 'site' },
      },
      MessageBody: {
        owner: 'org',
        repo: 'site',
        index: 'default',
        record: {
          title: '3 marketing predictions for a cookieless world',
          lastModified: 1625742256,
          path: '/document',
        },
        type: 'google',
      },
    }]);
  });

  it('retries if first page fetch returns 404', async () => {
    nock.content()
      .head('/live/document.md')
      .reply(200, '', { 'x-amz-meta-x-source-last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' });

    nock('https://main--site--org.aem.live')
      .get('/document')
      .reply(404)
      .get('/document')
      .replyWithFile(
        200,
        resolve(__testdir, 'index', 'fixtures', 'document.html'),
        { 'last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' },
      );

    const { request, context } = setupTest('/document');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
  });

  it('retries if first page fetch returns outdated document', async () => {
    nock.content()
      .head('/live/document.md')
      .reply(200, '', { 'x-amz-meta-x-source-last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' });

    nock('https://main--site--org.aem.live')
      .get('/document')
      .replyWithFile(
        200,
        resolve(__testdir, 'index', 'fixtures', 'document.html'),
        { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' },
      )
      .get('/document')
      .replyWithFile(
        200,
        resolve(__testdir, 'index', 'fixtures', 'document.html'),
        { 'last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' },
      );

    const { request, context } = setupTest('/document');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
  });

  it('removes indexed resoure if it is a redirect', async () => {
    nock.content()
      .head('/live/document.md')
      .reply(200, '', { 'x-amz-meta-x-source-last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' });

    nock('https://main--site--org.aem.live')
      .get('/document')
      .reply(301, '', { location: '/moved-here' });

    const { request, context } = setupTest('/document');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(entries, [{
      MessageAttributes: {
        owner: { DataType: 'String', StringValue: 'org' },
        repo: { DataType: 'String', StringValue: 'site' },
      },
      MessageBody: {
        owner: 'org',
        repo: 'site',
        index: 'default',
        record: {
          path: '/document',
        },
        type: 'google',
        deleted: true,
      },
    }]);
  });

  it('ignores resources in `.helix`', async () => {
    nock.indexConfig(INDEX_CONFIG);

    const { request, context } = setupTest('/.helix/config.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 204);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
    });
  });
});
