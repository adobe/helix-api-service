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
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

const CONTENT_BUS_ID = SITE_CONFIG.content.contentBusId;

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

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
    nock.indexConfig(INDEX_CONFIG);
    nock.sitemapConfig(`
sitemaps:
  default:
    source: /sitemap-index.json
    destination: /sitemap.xml`);
  });

  afterEach(() => {
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

  it.skip('reindex everything', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, { data: [] })
      .getObject('/live/fr/query-index.json')
      .reply(200, { data: [] });
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/live/`, [
      { Key: 'en/english.md' },
      { Key: 'fr/french.md' },
    ], '');

    const { request, context } = setupTest();
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
  });
});
