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

describe('Index Handler Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(method = 'POST') {
    const suffix = '/org/sites/site/index/document';

    const request = new Request(`https://api.aem.live${suffix}`, {
      method,
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
      },
    };
    return { request, context };
  }

  it('return 405 with method not allowed', async () => {
    const { request, context } = setupTest('PUT');
    const response = await main(request, context);

    assert.strictEqual(response.status, 405);
    assert.strictEqual(await response.text(), 'method not allowed');
  });

  it('reports error if index definition is not found', async () => {
    nock.indexConfig(null);
    nock.sitemapConfig(null);
    nock.content()
      .head('/live/sitemap.json')
      .reply(404);

    const { request, context } = setupTest();
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'no index configuration could be loaded for document org/site/document',
    });
  });

  it('reports error if loading index definition causes an error', async () => {
    nock.content()
      .getObject('/preview/.helix/query.yaml')
      .reply(500);

    const { request, context } = setupTest();
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'no index configuration could be loaded for document org/site/document',
    });
  });
});
