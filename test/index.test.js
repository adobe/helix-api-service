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

  it('succeeds calling login handler', async () => {
    const result = await main(new Request('https://localhost/'), {
      pathInfo: {
        suffix: '/login',
      },
    });
    assert.strictEqual(result.status, 200);
  });

  it('fails calling login handler with suffix', async () => {
    const result = await main(new Request('https://localhost/'), {
      pathInfo: {
        suffix: '/login/path',
      },
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling code handler', async () => {
    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    nock.orgConfig(ORG_CONFIG, { org: 'owner' });

    const result = await main(new Request('https://localhost/'), {
      pathInfo: {
        suffix: '/owner/sites/repo/code/main/',
      },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'method not allowed');
  });

  it('succeeds calling code handler with trailing path', async () => {
    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    nock.orgConfig(ORG_CONFIG, { org: 'owner' });

    const result = await main(new Request('https://localhost/', {
      method: 'POST',
      headers: {
        'x-github-token': 'token',
        'x-github-base': 'https://my.github.com',
      },
    }), {
      pathInfo: {
        suffix: '/owner/sites/repo/code/main/src/scripts.js',
      },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'NYI');
  });

  it('fails calling code handler with incomplete match', async () => {
    const result = await main(new Request('https://localhost/'), {
      pathInfo: {
        suffix: '/owner/sites/repo/code',
      },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('fails calling status handler without trailing path', async () => {
    const result = await main(new Request('https://localhost/'), {
      pathInfo: {
        suffix: '/owner/sites/repo/status',
      },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling status handler with trailing path', async () => {
    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);

    nock.content()
      .head('/live/document.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
      .getObject('/live/redirects.json')
      .reply(404)
      .head('/preview/document.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 09:04:16 GMT' })
      .getObject('/preview/redirects.json')
      .reply(404);

    const result = await main(new Request('https://localhost/'), {
      pathInfo: {
        suffix: '/org/sites/site/status/document',
      },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      edit: {},
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
    nock.orgConfig(ORG_CONFIG);

    const result = await main(new Request('https://localhost/'), {
      pathInfo: {
        suffix: '/org/sites/site/status/document',
      },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(false),
      },
    });
    assert.strictEqual(result.status, 403);
  });

  it('fails calling status handler with missing site config', async () => {
    nock.siteConfig().reply(404);

    const result = await main(new Request('https://localhost/'), {
      pathInfo: {
        suffix: '/org/sites/site/status/document',
      },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling profiles handler', async () => {
    nock.orgConfig(ORG_CONFIG);

    const result = await main(new Request('https://localhost/'), {
      pathInfo: {
        suffix: '/org/profiles',
      },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), '');
  });

  it('fails calling profiles handler with missing org', async () => {
    nock.orgConfig()
      .reply(404);

    const result = await main(new Request('https://localhost/'), {
      pathInfo: {
        suffix: '/org/profiles',
      },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
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
});
