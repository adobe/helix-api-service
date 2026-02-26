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
import { Request, Response } from '@adobe/fetch';
import sinon from 'sinon';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { Nock, SITE_CONFIG } from '../utils.js';
import { main } from '../../src/index.js';
import codebus from '../../src/code/codebus.js';
import purge from '../../src/cache/purge.js';

describe('Code Handler Tests', () => {
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    nock.done();
    sandbox.restore();
  });

  function setupTest(path = '/', { data, redirects, method = 'POST' } = {}) {
    const suffix = `/owner/repos/repo/code${path}`;
    const query = new URLSearchParams(data);

    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      method,
      headers: {
        'x-request-id': 'rid',
        'content-type': data ? 'application/json' : 'text/plain',
      },
      body: data ? JSON.stringify(data) : null,
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

  it('sends method not allowed for unsupported method', async () => {
    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/ref/en/blogs/may-21', {
      method: 'PUT',
    });

    const result = await main(request, context);
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'method not allowed');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('rejects unauthenticated for DELETE', async () => {
    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/ref/en/blogs/may-21', {
      method: 'DELETE',
    });

    const result = await main(request, context);
    assert.strictEqual(result.status, 403);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'delete not allowed if not authenticated.',
    });
  });

  it('rejects cross original repository sync requests', async () => {
    nock.siteConfig({
      ...SITE_CONFIG,
      code: {
        source: {
          url: 'https://github.com/owner/repo-another',
        },
        owner: 'owner',
        repo: 'repo-another',
      },
    }, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/ref/en/blogs/may-21');
    const result = await main(request, context);
    assert.strictEqual(result.status, 403);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'Code operation restricted to canonical source: owner/repo-another',
      'x-error-code': 'AEM_ NOT_CANONICAL_CODE_SOURCE',
    });
  });

  it('handles code action', async () => {
    sandbox.stub(codebus, 'update').callsFake(() => new Response('', {
      status: 200,
    }));

    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/ref/script.js');
    const result = await main(request, context);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles code action to non canonical byogit repo', async () => {
    sandbox.stub(codebus, 'update').callsFake(() => new Response('', {
      status: 200,
    }));
    nock.siteConfig({
      ...SITE_CONFIG,
      code: {
        source: {
          url: 'https://byo.git/api',
        },
        owner: 'another-owner',
        repo: 'another-repo',
      },
    }, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/ref/script.js');
    const result = await main(request, context);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles errors from code action', async () => {
    sandbox.stub(codebus, 'update').callsFake(() => new Response('', {
      status: 504,
    }));

    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/ref/script.js');
    const result = await main(request, context);
    assert.strictEqual(result.status, 504);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles code status', async () => {
    sandbox.stub(codebus, 'status').callsFake(() => new Response('', {
      status: 200,
    }));

    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/ref/script.js', { method: 'GET' });
    const result = await main(request, context);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('handles list branches', async () => {
    sandbox.stub(codebus, 'listBranches').callsFake(() => new Response('', {
      status: 200,
    }));

    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/*', { method: 'GET' });
    const result = await main(request, context);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('handles remove action', async () => {
    sandbox.stub(codebus, 'remove').callsFake(() => new Response('', {
      status: 204,
    }));
    let purgeInfos = [];
    sandbox.stub(purge, 'code').callsFake((ctx, info, infos) => {
      purgeInfos = infos;
    });

    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/ref/script.js', { method: 'DELETE' });
    context.attributes.authInfo.withRole('develop');
    const result = await main(request, context);
    assert.strictEqual(result.status, 204);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
    assert.deepStrictEqual(purgeInfos, ['/script.js']);
  });

  it('handles bulk remove action', async () => {
    sandbox.stub(codebus, 'update').callsFake(() => new Response('', {
      status: 200,
    }));

    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/ref/*', { method: 'DELETE' });
    context.attributes.authInfo.withRole('develop');
    const result = await main(request, context);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('handles errors from remove action', async () => {
    sandbox.stub(codebus, 'remove').callsFake(() => new Response('', {
      status: 401,
    }));
    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    const { request, context } = setupTest('/ref/script.js', { method: 'DELETE' });
    context.attributes.authInfo.withRole('develop');
    const result = await main(request, context);
    assert.strictEqual(result.status, 401);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });
});
