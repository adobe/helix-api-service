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

describe('Index Status Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
    nock.sitemapConfig(null);
    nock.content()
      .head('/live/sitemap.json')
      .reply(404);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/') {
    const suffix = `/org/sites/site/index${path}`;

    const request = new Request(`https://api.aem.live${suffix}`, {
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        googleApiOpts: { retry: false },
      },
      runtime: { region: 'us-east-1' },
      env: {
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    };
    return { request, context };
  }

  it('returns index status', async () => {
    nock.indexConfig(INDEX_CONFIG);

    nock('https://main--site--org.aem.live')
      .get('/document')
      .replyWithFile(
        200,
        resolve(__testdir, 'index', 'fixtures', 'document.html'),
        { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' },
      );

    const { request, context } = setupTest('/document');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      results: [{
        name: 'default',
        result: {
          record: {
            lastModified: 1625738656,
            title: '3 marketing predictions for a cookieless world',
          },
        },
        type: 'google',
      }],
      resourcePath: '/document.md',
      webPath: '/document',
    });
  });

  it('reports a page that either has status 301 or 404', async () => {
    nock.indexConfig(INDEX_CONFIG);

    nock('https://main--site--org.aem.live')
      .get('/document')
      .reply(404);

    const { request, context } = setupTest('/document');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      results: [{
        name: 'default',
        result: {
          message: 'requested path returned a 301 or 404',
          noIndex: true,
        },
        type: 'google',
      }],
      resourcePath: '/document.md',
      webPath: '/document',
    });
  });

  it('reports error if loading page fails', async () => {
    nock.indexConfig(INDEX_CONFIG);

    nock('https://main--site--org.aem.live')
      .get('/document')
      .reply(500);

    const { request, context } = setupTest('/document');
    const response = await main(request, context);

    assert.strictEqual(response.status, 500);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'fetching https://main--site--org.aem.live/document failed',
    });
  });

  it('ignores resources that are index targets', async () => {
    nock.indexConfig(INDEX_CONFIG);

    const { request, context } = setupTest('/query-index.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 204);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
    });
  });
});
