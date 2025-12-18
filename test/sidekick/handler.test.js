/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
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

describe('Sidekick Handler Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest({
    method = 'GET',
    authInfo = AuthInfo.Default().withAuthenticated(true),
    path = '/config.json',
  } = {}) {
    const suffix = `/org/sites/site/sidekick${path}`;

    const request = new Request(`https://api.aem.live${suffix}`, {
      method,
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo,
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
      },
    };
    return { request, context };
  }

  describe('handles not allowed methods', () => {
    for (const method of ['POST', 'DELETE', 'PUT']) {
      // eslint-disable-next-line no-loop-func
      it(`${method} sends method not allowed`, async () => {
        nock.siteConfig(SITE_CONFIG);

        const { request, context } = setupTest({ method });
        const result = await main(request, context);

        assert.strictEqual(result.status, 405);
        assert.strictEqual(await result.text(), 'method not allowed');
        assert.deepStrictEqual(result.headers.plain(), {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store, private, must-revalidate',
        });
      });
    }
  });

  it('GET sends config.json', async () => {
    nock.siteConfig({
      ...SITE_CONFIG,
      limits: {
        admin: {
          trustedHosts: ['*.example.com'],
        },
      },
      cdn: {
        prod: {
          host: 'host.prod',
          route: ['/en'],
        },
        preview: {
          host: 'host.preview',
        },
        live: {
          host: 'host.live',
        },
        review: {
          host: 'host.reviews',
        },
      },
      sidekick: {
        project: 'news',
        plugins: [],
      },
    });

    const { request, context } = setupTest();
    const result = await main(request, context);

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      project: 'news',
      plugins: [],
      contentSourceType: 'google',
      contentSourceUrl: 'https://drive.google.com/drive/u/0/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
      previewHost: 'host.preview',
      liveHost: 'host.live',
      reviewHost: 'host.reviews',
      host: 'host.prod',
      routes: ['/en'],
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('GET sends config.json missing the sidekick object', async () => {
    nock.siteConfig(SITE_CONFIG);

    const { request, context } = setupTest();
    const result = await main(request, context);

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      project: 'Sample site',
      previewHost: 'main--site--org.aem.page',
      liveHost: 'main--site--org.aem.live',
      contentSourceType: 'google',
      contentSourceUrl: 'https://drive.google.com/drive/u/0/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
      host: 'www.example.com',
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('GET sends 403 for missing permissions', async () => {
    nock.siteConfig({
      ...SITE_CONFIG,
      access: {
        admin: {
          defaultRole: 'site_preview',
        },
      },
    });

    const { request, context } = setupTest({
      authInfo: AuthInfo.Default().withAuthenticated(true),
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 403);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'not authorized',
    });
  });

  it('GET sends 404 for non config requests', async () => {
    nock.siteConfig(SITE_CONFIG);

    const { request, context } = setupTest({
      path: '/tools/foo.json',
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 404);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'not found',
      vary: 'Accept-Encoding',
    });
  });
});

// TODO: add tests for CSRF protection
