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
import { INTERNAL_SITEMAP_INDEX } from '../../src/index/utils.js';
import { Nock, SITE_CONFIG } from '../utils.js';

describe('Index Update Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {object[]} */
  const entries = [];

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
    nock.sitemapConfig(null);
    nock.sqs('helix-indexer', entries);
  });

  afterEach(() => {
    entries.length = 0;

    nock.done();
  });

  function setupTest(path = '/') {
    const suffix = `/org/sites/site/index${path}`;

    const request = new Request(`https://api.aem.live${suffix}`, {
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

  describe('Standard index', () => {
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

    beforeEach(() => {
      nock.content()
        .head('/live/sitemap.json')
        .reply(404)
        .head('/live/document.md')
        .reply(200, '', { 'x-amz-meta-x-source-last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' });
      nock.indexConfig(INDEX_CONFIG);
    });

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

    it('removes indexed resource if it is a redirect', async () => {
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

    it('reports error if HTML document is malformed', async () => {
      nock('https://main--site--org.aem.live')
        .get('/document')
        .reply(200, '<html><head></head><main></main>');

      const { request, context } = setupTest('/document');
      const response = await main(request, context);

      assert.strictEqual(response.status, 502);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'document returned from https://main--site--org.aem.live/document seems incomplete (html end tag not found)',
      });
    });

    it('reports error if we hit a login redirect', async () => {
      nock('https://main--site--org.aem.live')
        .get('/document')
        .reply(302);

      const { request, context } = setupTest('/document');
      const response = await main(request, context);

      assert.strictEqual(response.status, 401);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'unauthorized to fetch https://main--site--org.aem.live/document',
      });
    });

    it('reports error if fetching the live URL throws', async () => {
      nock('https://main--site--org.aem.live')
        .get('/document')
        .replyWithError('Boom!');

      const { request, context } = setupTest('/document');
      const response = await main(request, context);

      assert.strictEqual(response.status, 502);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'fetching https://main--site--org.aem.live/document failed',
      });
    });

    it('ignores resources in `.helix`', async () => {
      const { request, context } = setupTest('/.helix/config.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 204);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
      });
    });
  });

  describe('Site index', () => {
    const INDEX_CONFIG = `
    indices:
      sitemap:
        target: /sitemap-index.json
        properties:
          lastModified:
            select: none
            value: |
              parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')
    `;

    beforeEach(() => {
      nock.content()
        .head('/live/sitemap.json')
        .reply(404);
      nock.indexConfig(INDEX_CONFIG);
    });

    it('updates indexed resource', async () => {
      nock.content()
        .head('/live/sample.pdf')
        .reply(404);

      nock('https://main--site--org.aem.live')
        .head('/sample.pdf')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' });

      const { request, context } = setupTest('/sample.pdf');
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
          index: 'sitemap',
          record: {
            lastModified: 1625742256,
            path: '/sample.pdf',
          },
          type: 'google',
        },
      }]);
    });
  });

  describe(INTERNAL_SITEMAP_INDEX, () => {
    beforeEach(() => {
      nock.indexConfig(null);
      nock.content()
        .head('/live/sitemap.json')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' })
        .head('/live/document.md')
        .reply(200, '', { 'x-amz-meta-x-source-last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' });
    });

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
          index: INTERNAL_SITEMAP_INDEX,
          record: {
            lastModified: 1625742256,
            path: '/document',
          },
          type: 'markup',
        },
      }]);
    });

    it('removes indexed resource with `noindex` in its `robots` property', async () => {
      nock('https://main--site--org.aem.live')
        .get('/document')
        .replyWithFile(
          200,
          resolve(__testdir, 'index', 'fixtures', 'noindex.html'),
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
          index: INTERNAL_SITEMAP_INDEX,
          record: {
            path: '/document',
          },
          type: 'markup',
          deleted: true,
        },
      }]);
    });
  });
});
