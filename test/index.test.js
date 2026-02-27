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
import { main, router } from '../src/index.js';
import { Nock, ORG_CONFIG, SITE_CONFIG } from './utils.js';
import { AuthInfo } from '../src/auth/auth-info.js';

describe('Index Tests', () => {
  /** @type {import('./utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(suffix, {
    method, headers, attributes, env, invocation,
  } = {}) {
    const request = new Request(`https://api.aem.live${suffix}`, {
      method,
      headers,
    });
    const context = {
      pathInfo: { suffix },
      attributes,
      env,
      invocation,
    };
    return { request, context };
  }

  it('succeeds calling login handler', async () => {
    const { request, context } = setupTest('/login');
    const result = await main(request, context);

    assert.strictEqual(result.status, 200);
  });

  it('fails calling login handler with suffix', async () => {
    const { request, context } = setupTest('/login/path');
    const result = await main(request, context);

    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling code handler', async () => {
    nock.siteConfig(SITE_CONFIG);

    const { request, context } = setupTest('/org/repos/site/code/main/', {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 403);
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Code operation restricted to canonical source: owner/repo',
      'x-error-code': 'AEM_ NOT_CANONICAL_CODE_SOURCE',
    });
  });

  it('fails calling code handler with incomplete match', async () => {
    const { request, context } = setupTest('/org/repos/site/code', {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('fails calling status handler without trailing path', async () => {
    const { request, context } = setupTest('/org/sites/site/status', {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling status handler with trailing path', async () => {
    nock.siteConfig(SITE_CONFIG);

    nock.content()
      .head('/live/document.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
      .getObject('/live/redirects.json')
      .reply(404)
      .head('/preview/document.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 09:04:16 GMT' })
      .getObject('/preview/redirects.json')
      .reply(404);

    const { request, context } = setupTest('/org/sites/site/status/document', {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      edit: {},
      links: {
        code: 'https://api.aem.live/org/repos/site/code/main/document',
        live: 'https://api.aem.live/org/sites/site/live/document',
        preview: 'https://api.aem.live/org/sites/site/preview/document',
        status: 'https://api.aem.live/org/sites/site/status/document',
      },
      live: {
        contentBusId: `helix-content-bus/${SITE_CONFIG.content.contentBusId}/live/document.md`,
        contentType: 'text/plain; charset=utf-8',
        lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
        permissions: [
          'read',
          'write',
        ],
        sourceLocation: 'google:*',
        status: 200,
        url: 'https://main--site--org.aem.live/document',
      },
      preview: {
        contentBusId: `helix-content-bus/${SITE_CONFIG.content.contentBusId}/preview/document.md`,
        contentType: 'text/plain; charset=utf-8',
        lastModified: 'Thu, 08 Jul 2021 09:04:16 GMT',
        permissions: [
          'read',
          'write',
        ],
        sourceLocation: 'google:*',
        status: 200,
        url: 'https://main--site--org.aem.page/document',
      },
      resourcePath: '/document.md',
      webPath: '/document',
    });
  });

  it('fails calling status handler when not authenticated', async () => {
    nock.siteConfig(SITE_CONFIG);

    const { request, context } = setupTest('/org/sites/site/status/document', {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(false),
      },
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 401);
  });

  it('fails calling status handler with missing site config', async () => {
    nock.siteConfig().reply(404);

    const { request, context } = setupTest('/org/sites/site/status/document', {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling profiles handler', async () => {
    nock.orgConfig(ORG_CONFIG);

    const { request, context } = setupTest('/org/profiles', {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), '');
  });

  it.skip('fails calling profiles handler with missing org', async () => {
    nock.orgConfig()
      .reply(404);

    const { request, context } = setupTest('/org/profiles', {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('sends 204 for OPTIONS request', async () => {
    const { request, context } = setupTest('/org/sites/site/status/', {
      method: 'OPTIONS',
      headers: {
        origin: 'api.aem.live',
      },
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 204);
    assert.deepStrictEqual(result.headers.plain(), {
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, HEAD, POST, PUT, OPTIONS, DELETE',
      'access-control-allow-headers': 'Authorization, x-auth-token, x-content-source-authorization, content-type',
      'access-control-allow-origin': 'api.aem.live',
      'access-control-max-age': '86400',
      'access-control-expose-headers': 'x-error, x-error-code',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('accepts roles in event payload to authorize', async () => {
    nock.siteConfig(SITE_CONFIG);

    const { request, context } = setupTest('/org/sites/site/media/', {
      method: 'POST',
      headers: {
        origin: 'api.aem.live',
      },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      invocation: {
        event: {
          user: 'user@example.com',
          roles: ['ops'],
        },
      },
    });

    const result = await main(request, context);

    assert.strictEqual(result.status, 400);
    assert.deepStrictEqual(result.headers.plain(), {
      'access-control-allow-credentials': 'true',
      'access-control-allow-origin': 'api.aem.live',
      'access-control-expose-headers': 'x-error, x-error-code',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'missing media in request body',
    });
  });

  it('verifies extraction of variables', () => {
    const entries = [{
      suffix: '/auth/discovery/keys',
      variables: {
        route: 'auth', path: '/discovery/keys',
      },
    }, {
      suffix: '/login',
      variables: {
        route: 'login',
      },
    }, {
      suffix: '/login/no/suffix',
      variables: undefined,
    }, {
      suffix: '/owner',
      variables: {
        route: 'org', org: 'owner',
      },
    }, {
      suffix: '/owner/sites',
      variables: {
        route: 'sites', org: 'owner',
      },
    }, {
      suffix: '/owner/sites/repo/status/document',
      variables: {
        route: 'status', org: 'owner', site: 'repo', path: '/document',
      },
    }];

    entries.forEach((entry) => {
      const { variables } = router.match(entry.suffix) ?? {};
      assert.deepStrictEqual(variables, entry.variables);
    });
  });

  it('uses a bad route name', () => {
    assert.throws(
      () => router.external('bad', {}),
      new Error('route not found: bad'),
    );
  });
});
