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
import sinon from 'sinon';
import xml2js from 'xml2js';
import { Request, Response } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import purge from '../../src/cache/purge.js';
import { METADATA_JSON_PATH, REDIRECTS_JSON_PATH } from '../../src/contentbus/contentbus.js';
import { main } from '../../src/index.js';
import sitemap from '../../src/sitemap/update.js';
import { Nock, ORG_CONFIG, SITE_CONFIG } from '../utils.js';

describe('Publish Action Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  /** @type {object[]} */
  const entries = [];

  /** @type {string[]} */
  let surrogates;

  /** @type {import('../../src/cache/purge.js').PurgeInfo[]} */
  let purgeInfos;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();

    sandbox.stub(purge, 'perform').callsFake((context, info, infos) => {
      purgeInfos = infos;
    });
    sandbox.stub(purge, 'surrogate').callsFake((context, info, keys) => {
      surrogates = keys;
    });

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
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
      method: 'POST',
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        infoMarkerChecked: true,
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

  describe('no indexing or sitemap configuration', () => {
    beforeEach(() => {
      nock.indexConfig(null);
      nock.sitemapConfig(null);
      nock.content()
        .head('/live/sitemap.json')
        .reply(200, [])
        .putObject('/live/sitemap.json')
        .reply(201);
    });

    it('publish document', async () => {
      nock.content()
        .head('/preview/index.md')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
        .copyObject('/live/index.md')
        .reply(200, new xml2js.Builder().buildObject({
          CopyObjectResult: {
            LastModified: '2021-05-05T08:37:23.000Z',
            ETag: '"f278c0035a9b4398629613a33abe6451"',
          },
        }))
        .head('/live/index.md')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

      const { request, context } = setupTest('/');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(purgeInfos, [
        { path: '/' },
        { path: '/index.plain.html' },
        { key: 'DiyvKbkf2MaZORJJ' },
        { key: '8lnjgOWBwsoqAQXB' },
      ]);
    });

    it('publish redirects', async () => {
      nock.content()
        .head('/preview/redirects.json')
        .reply(200)
        .copyObject('/live/redirects.json')
        .reply(200, new xml2js.Builder().buildObject({
          CopyObjectResult: {
            LastModified: '2021-05-05T08:37:23.000Z',
            ETag: '"f278c0035a9b4398629613a33abe6451"',
          },
        }))
        .getObject('/live/redirects.json')
        .reply(200, {
          default: {
            data: {
              source: '/from',
              destination: '/to',
            },
          },
        })
        .head('/live/redirects.json')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

      const { request, context } = setupTest(REDIRECTS_JSON_PATH);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
    });

    it('publish redirects with forced update', async () => {
      nock.content()
        .head('/preview/redirects.json')
        .reply(200)
        .copyObject('/live/redirects.json')
        .reply(200, new xml2js.Builder().buildObject({
          CopyObjectResult: {
            LastModified: '2021-05-05T08:37:23.000Z',
            ETag: '"f278c0035a9b4398629613a33abe6451"',
          },
        }))
        .getObject('/live/redirects.json')
        .reply(200, {
          default: {
            data: {
              source: '/from',
              destination: '/to',
            },
          },
        })
        .head('/live/redirects.json')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

      const { request, context } = setupTest(REDIRECTS_JSON_PATH, {
        data: {
          forceUpdateRedirects: true,
        },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
    });

    it('publish metadata', async () => {
      nock.content()
        .head('/preview/metadata.json')
        .reply(200)
        .copyObject('/live/metadata.json')
        .reply(200, new xml2js.Builder().buildObject({
          CopyObjectResult: {
            LastModified: '2021-05-05T08:37:23.000Z',
            ETag: '"f278c0035a9b4398629613a33abe6451"',
          },
        }))
        .head('/live/metadata.json')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

      const { request, context } = setupTest(METADATA_JSON_PATH);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(surrogates, ['U_NW4adJU7Qazf-I']);
    });

    it('reports an error when `contentBusCopy` returns 404', async () => {
      nock.content()
        .head('/preview/index.md')
        .reply(200)
        .copyObject('/live/index.md')
        .reply(404, new xml2js.Builder().buildObject({
          Error: {
            Code: 'NoSuchKey',
            Message: 'The specified key does not exist.',
          },
        }));

      const { request, context } = setupTest('/');
      const response = await main(request, context);

      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': `source does not exist: helix-content-bus/${SITE_CONFIG.content.contentBusId}/preview/index.md`,
      });
    });

    it('tweaks status when `contentBusCopy` returns 404 and a redirect matches', async () => {
      nock.content()
        .head('/preview/index.md')
        .reply(200)
        .copyObject('/live/index.md')
        .reply(404, new xml2js.Builder().buildObject({
          Error: {
            Code: 'NoSuchKey',
            Message: 'The specified key does not exist.',
          },
        }))
        .putObject('/live/index.md')
        .reply(201, function fn(uri, body) {
          assert.strictEqual(this.req.headers['x-amz-meta-redirect-location'], '/target');
          assert.strictEqual(body, '/target');
        })
        .head('/live/index.md')
        .twice()
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

      const { request, context } = setupTest('/', {
        redirects: {
          '/index.md': '/target',
        },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        live: {
          configRedirectLocation: '/target',
          contentBusId: `helix-content-bus/${SITE_CONFIG.content.contentBusId}/live/index.md`,
          contentType: 'text/plain; charset=utf-8',
          lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
          permissions: [
            'delete', 'read', 'write',
          ],
          sourceLocation: 'google:*',
          status: 200,
          url: 'https://main--site--org.aem.live/',
        },
        resourcePath: '/index.md',
        webPath: '/',
      });
    });
  });

  describe('indexing, but no sitemap configuration', () => {
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
      nock.indexConfig(INDEX_CONFIG);
      nock.sitemapConfig(null);
      nock.sqs('helix-indexer', entries);
      nock.content()
        .head('/live/sitemap.json')
        .reply(404)
        .putObject('/live/sitemap.json')
        .reply(201);
    });

    it('publish document', async () => {
      nock('https://main--site--org.aem.live')
        .get('/document')
        .replyWithFile(
          200,
          resolve(__testdir, 'index', 'fixtures', 'document.html'),
          { 'last-modified': 'Thu, 08 Jul 2021 11:04:16 GMT' },
        );

      nock.content()
        .head('/preview/document.md')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
        .copyObject('/live/document.md')
        .reply(200, new xml2js.Builder().buildObject({
          CopyObjectResult: {
            LastModified: '2021-05-05T08:37:23.000Z',
            ETag: '"f278c0035a9b4398629613a33abe6451"',
          },
        }))
        .head('/live/document.md')
        .twice()
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

      const { request, context } = setupTest('/document');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(entries.length, 1);
    });

    it('publish query index', async () => {
      nock.content()
        .head('/preview/query-index.json')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
        .copyObject('/live/query-index.json')
        .reply(200, new xml2js.Builder().buildObject({
          CopyObjectResult: {
            LastModified: '2021-05-05T08:37:23.000Z',
            ETag: '"f278c0035a9b4398629613a33abe6451"',
          },
        }))
        .head('/live/query-index.json')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

      const { request, context } = setupTest('/query-index.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(entries.length, 0);
    });
  });

  describe('indexing and sitemap configuration', () => {
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
    const SITEMAP_CONFIG = `
    version: 1
    sitemaps:
      default:
        source: /sitemap-index.json
        destination: /sitemap.xml
    `;
    beforeEach(() => {
      nock.indexConfig(INDEX_CONFIG);
      nock.sitemapConfig(SITEMAP_CONFIG);
      nock.sqs('helix-indexer', entries);
    });

    it('publish sitemap index', async () => {
      sandbox.stub(sitemap, 'sourceChanged')
        .returns(new Response({
          paths: ['/sitemap.xml'],
        }));

      nock.content()
        .head('/preview/sitemap-index.json')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
        .copyObject('/live/sitemap-index.json')
        .reply(200, new xml2js.Builder().buildObject({
          CopyObjectResult: {
            LastModified: '2021-05-05T08:37:23.000Z',
            ETag: '"f278c0035a9b4398629613a33abe6451"',
          },
        }))
        .head('/live/sitemap-index.json')
        .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

      const { request, context } = setupTest('/sitemap-index.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(purgeInfos, [
        { key: 'sby9rtkIBtNieA0T' },
        { key: 'p_sby9rtkIBtNieA0T' },
        { path: '/sitemap.xml' },
      ]);
    });
  });
});
