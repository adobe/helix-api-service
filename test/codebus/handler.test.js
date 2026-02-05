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
import esmock from 'esmock';
import { Request, Response } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import {
  DEFAULT_CONTEXT_MAIN, Nock, main, SITE_CONFIG,
} from '../utils.js';

const HELIX_CONFIG = JSON.stringify({
  head: {},
  fstab: {
    data: {
      mountpoints: [{
        url: 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
        path: '/',
        contentBusId: '1234',
      }],
    },
  },
});

describe('Code Handler Tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('sends method not allowed for unsupported method', async () => {
    nock.config(null);
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'PUT',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/ref/en/blogs/may-21',
      },
    }));
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'method not allowed');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('rejects unauthenticated for DELETE', async () => {
    nock.config(null);
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'DELETE',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/ref/en/blogs/may-21',
      },
    }));
    assert.strictEqual(result.status, 403);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'delete not allowed if not authenticated.',
    });
  });

  it('rejects cross original repository sync requests', async () => {
    nock.config(SITE_CONFIG, 'org', 'site');
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/org/site/ref/en/blogs/may-21',
      },
    }));
    assert.strictEqual(result.status, 403);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'Code operation restricted to canonical source: owner/repo',
      'x-error-code': 'AEM_ NOT_CANONICAL_CODE_SOURCE',
    });
  });

  it('POST requires org parameter', async () => {
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code',
      },
    }));
    assert.strictEqual(result.status, 400);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'invalid path parameters: "org" is required',
    });
  });

  it('POST requires site parameter', async () => {
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner',
      },
    }));
    assert.strictEqual(result.status, 400);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'invalid path parameters: "site" is required',
    });
  });

  it('POST requires ref parameter', async () => {
    nock.config(null);
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo',
      },
    }));
    assert.strictEqual(result.status, 400);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'invalid path parameters: "ref" is required',
    });
  });

  it.skip('rejects operation to non canonical repo', async () => {
    nock.config({
      ...SITE_CONFIG,
      code: {
        ...SITE_CONFIG.code,
        owner: 'another-owner',
        repo: 'another-repo',
      },
    });
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/ref/en/blogs/may-21',
      },
    }));
    assert.strictEqual(result.status, 403);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'Code operation restricted to canonical source: another-owner/another-repo',
      'x-error-code': 'AEM_ NOT_CANONICAL_CODE_SOURCE',
    });
  });

  it('handles code action', async () => {
    nock.config(null, 'owner', 'repo', 'main');
    const { main: proxyMain } = await esmock('../../src/index.js', {
      '../../src/codebus/handler.js': await esmock('../../src/codebus/handler.js', {
        '../../src/codebus/update.js': {
          update: async (ctx, info) => {
            assert.deepStrictEqual(info.toJSON(), {
              headers: {},
              host: 'admin.hlx.page',
              method: 'POST',
              query: {},
              cookies: {},
              functionPath: '',
              scheme: 'https',
              suffix: '/code/OWNER/REPO/main/',
              owner: 'owner',
              org: 'owner',
              path: '/',
              rawPath: '/',
              ref: 'main',
              branch: 'main',
              repo: 'repo',
              site: 'repo',
              resourcePath: '/index.md',
              ext: '.md',
              route: 'code',
            });
            return new Response('', {
              status: 200,
            });
          },
        },
      }),
    });

    const result = await proxyMain(new Request('https://admin.hlx.page/', { method: 'POST' }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/OWNER/REPO/main/',
      },
    }));
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles code action to non canonical byogit repo', async () => {
    nock.config({
      ...SITE_CONFIG,
      code: {
        source: {
          url: 'https://byo.git/api',
        },
        owner: 'another-owner',
        repo: 'another-repo',
      },
    });
    const { main: proxyMain } = await esmock('../../src/index.js', {
      '../../src/codebus/handler.js': await esmock('../../src/codebus/handler.js', {
        '../../src/codebus/update.js': {
          update: async (ctx, info) => {
            assert.deepStrictEqual(info.toJSON(), {
              headers: {},
              host: 'admin.hlx.page',
              method: 'POST',
              query: {},
              cookies: {},
              functionPath: '',
              scheme: 'https',
              suffix: '/code/owner/repo/main/',
              owner: 'another-owner',
              org: 'owner',
              path: '/',
              rawPath: '/',
              ref: 'main',
              branch: 'main',
              repo: 'another-repo',
              site: 'repo',
              resourcePath: '/index.md',
              ext: '.md',
              route: 'code',
            });
            return new Response('', {
              status: 200,
            });
          },
        },
      }),
    });

    const result = await proxyMain(new Request('https://admin.hlx.page/', { method: 'POST' }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/main/',
      },
    }));
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles code action (with unsupported characters payload ref)', async () => {
    nock.config(null, 'owner', 'repo', 'main');
    const { main: proxyMain } = await esmock('../../src/index.js', {
      '../../src/codebus/handler.js': await esmock('../../src/codebus/handler.js', {
        '../../src/codebus/update.js': {
          update: async (ctx, info) => {
            assert.deepStrictEqual(info.toJSON(), {
              headers: {
                'content-type': 'application/json',
              },
              host: 'admin.hlx.page',
              method: 'POST',
              query: {},
              cookies: {},
              functionPath: '',
              scheme: 'https',
              suffix: '/code/OWNER/REPO/renovate-yargs-18-x',
              owner: 'owner',
              org: 'owner',
              path: '/',
              rawPath: '',
              ref: 'renovate-yargs-18-x',
              branch: 'renovate-yargs-18.x',
              repo: 'repo',
              site: 'repo',
              resourcePath: '/index.md',
              ext: '.md',
              route: 'code',
            });
            return new Response('', {
              status: 200,
            });
          },
        },
      }),
    });

    const result = await proxyMain(new Request('https://admin.hlx.page/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        installationId: 1234,
        owner: 'OWNER',
        repo: 'REPO',
        ref: 'renovate-yargs-18.x',
      }),
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/OWNER/REPO/renovate-yargs-18-x',
      },
    }));
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles code action (no fstab)', async () => {
    nock.config(null, 'owner', 'repo', 'main');
    nock.helixConfig(null, 'owner', 'repo', 'main');
    nock.fstab(null, 'owner', 'repo', 'main');
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .reply(404);
    const { main: proxyMain } = await esmock('../../src/index.js', {
      '../../src/codebus/handler.js': await esmock('../../src/codebus/handler.js', {
        '../../src/codebus/update.js': {
          update: async (ctx) => {
            assert.strictEqual('mountConfig' in ctx.attributes, false);
            return new Response('', {
              status: 200,
            });
          },
        },
      }),
    });

    const ctx = DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/main/',
      },
      attributes: {
        mountConfig: null,
      },
    });
    const result = await proxyMain(new Request('https://admin.hlx.page/', { method: 'POST' }), ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles code action for scripts', async () => {
    nock.config(null, 'owner', 'repo', 'main');
    const { main: proxyMain } = await esmock('../../src/index.js', {
      '../../src/codebus/handler.js': await esmock('../../src/codebus/handler.js', {
        '../../src/codebus/update.js': {
          update: async () => (new Response('', {
            status: 200,
          })),
        },
      }),
    });

    const result = await proxyMain(new Request('https://admin.hlx.page/', { method: 'POST' }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/main/scripts.js',
      },
    }));
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles code status', async () => {
    nock.config(null);
    const { main: proxyMain } = await esmock('../../src/index.js', {
      '../../src/codebus/handler.js': await esmock('../../src/codebus/handler.js', {
        '../../src/codebus/status.js': async (_, info) => {
          assert.deepStrictEqual(info.toJSON(), {
            headers: {},
            host: 'admin.hlx.page',
            method: 'GET',
            query: {},
            cookies: {},
            functionPath: '',
            scheme: 'https',
            suffix: '/code/owner/repo/ref/',
            owner: 'owner',
            org: 'owner',
            path: '/',
            rawPath: '/',
            ref: 'ref',
            branch: 'ref',
            repo: 'repo',
            site: 'repo',
            resourcePath: '/index.md',
            ext: '.md',
            route: 'code',
          });
          return new Response('', {
            status: 200,
          });
        },
      }),
    });

    const result = await proxyMain(new Request('https://admin.hlx.page/'), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/ref/',
      },
    }));
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('handles list branches', async () => {
    nock.config(null);
    const { main: proxyMain } = await esmock('../../src/index.js', {
      '../../src/codebus/handler.js': await esmock('../../src/codebus/handler.js', {
        '../../src/codebus/list-branches.js': async (_, info) => {
          assert.deepStrictEqual(info.toJSON(), {
            headers: {},
            host: 'admin.hlx.page',
            method: 'GET',
            query: {},
            cookies: {},
            functionPath: '',
            scheme: 'https',
            suffix: '/code/owner/repo/*',
            owner: 'owner',
            org: 'owner',
            path: '/',
            rawPath: '',
            ref: '*',
            branch: '*',
            repo: 'repo',
            site: 'repo',
            resourcePath: '/index.md',
            ext: '.md',
            route: 'code',
          });
          return new Response('', {
            status: 200,
          });
        },
      }),
    });

    const result = await proxyMain(new Request('https://admin.hlx.page/'), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/*',
      },
    }));
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('handles errors from code action', async () => {
    nock.config(null);
    const { main: proxyMain } = await esmock('../../src/index.js', {
      '../../src/codebus/handler.js': await esmock('../../src/codebus/handler.js', {
        '../../src/codebus/update.js': { update: async () => (new Response('', { status: 504 })) },
      }),
    });

    const result = await proxyMain(new Request('https://admin.hlx.page/?action=publish', { method: 'POST' }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/ref/',
      },
    }));
    assert.strictEqual(result.status, 504);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles remove action', async () => {
    nock.config(null);
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .delete('/owner/repo/ref/foo/bar.js?x-id=DeleteObject')
      .reply(204);
    nock('https://helix-code-bus.fake-account-id.r2.cloudflarestorage.com')
      .delete('/owner/repo/ref/foo/bar.js?x-id=DeleteObject')
      .reply(204);
    nock('https://api.fastly.com')
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(200);

    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'DELETE',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/ref/foo/bar.js',
      },
      attributes: {
        authInfo: AuthInfo.Default()
          .withAuthenticated(true)
          .withRole('develop'),
        helixConfig: HELIX_CONFIG,
        configAll: {},
        contentBusId: 'foo-id',
      },
    }));
    assert.strictEqual(result.status, 204);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles remove action of fstab.yaml', async () => {
    nock.config(null);
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .delete('/owner/repo/main/fstab.yaml?x-id=DeleteObject')
      .reply(204)
      .delete('/owner/repo/main/helix-config.json?x-id=DeleteObject')
      .reply(204);
    nock('https://helix-code-bus.fake-account-id.r2.cloudflarestorage.com')
      .delete('/owner/repo/main/fstab.yaml?x-id=DeleteObject')
      .reply(204)
      .delete('/owner/repo/main/helix-config.json?x-id=DeleteObject')
      .reply(204);
    nock('https://api.fastly.com')
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(200);

    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'DELETE',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/main/fstab.yaml',
      },
      attributes: {
        authInfo: AuthInfo.Default()
          .withAuthenticated(true)
          .withRole('develop'),
        helixConfig: HELIX_CONFIG,
        configAll: {},
        contentBusId: 'foo-id',
      },
    }));
    assert.strictEqual(result.status, 204);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles bulk remove action', async () => {
    nock.config(null);
    const { main: proxyMain } = await esmock('../../src/index.js', {
      '../../src/codebus/handler.js': await esmock('../../src/codebus/handler.js', {
        '../../src/codebus/update.js': {
          update: async () => (new Response('', {
            status: 200,
          })),
        },
      }),
    });

    const result = await proxyMain(new Request('https://admin.hlx.page/', {
      method: 'DELETE',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/ref/*',
      },
      attributes: {
        authInfo: AuthInfo.Admin().withAuthenticated(true),
        helixConfig: HELIX_CONFIG,
        configAll: {},
        contentBusId: 'foo-id',
      },
    }));
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles error from remove action', async () => {
    nock.config(null);
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .delete('/owner/repo/ref/foo/bar.js?x-id=DeleteObject')
      .reply(401);
    nock('https://helix-code-bus.fake-account-id.r2.cloudflarestorage.com')
      .delete('/owner/repo/ref/foo/bar.js?x-id=DeleteObject')
      .reply(204);

    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'DELETE',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/code/owner/repo/ref/foo/bar.js',
      },
      attributes: {
        authInfo: AuthInfo.Admin().withAuthenticated(true),
        helixConfig: HELIX_CONFIG,
        configAll: {},
        contentBusId: 'foo-id',
      },
    }));
    assert.strictEqual(result.status, 401);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'removing helix-code-bus/owner/repo/ref/foo/bar.js from storage failed: [S3] UnknownError',
    });
  });
});
