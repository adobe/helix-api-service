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
import { generateKeyPair } from 'crypto';
import { promisify } from 'util';
import { Response } from '@adobe/fetch';
import { promises as fs } from 'fs';
import path from 'path';
import sinon from 'sinon';
import { update } from '../../src/code/update.js';
import { StatusCodeError } from '../../src/support/StatusCodeError.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';
import { Job } from '../../src/job/job.js';
import { AuthInfo } from '../../src/auth/auth-info.js';

const getKeyPair = promisify(generateKeyPair);

describe('Code update tests', () => {
  let nock;
  let privateKey;
  before(async () => {
    const kp = await getKeyPair('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'pkcs1',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs1',
        format: 'pem',
      },
    });
    privateKey = kp.privateKey;
  });

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

  const BOT_TEST_CONTEXT = (suffix, overrides = {}) => createContext(suffix, {
    ...overrides,
    env: {
      GH_APP_ID: '1234',
      GH_APP_PRIVATE_KEY: privateKey,
      GH_CLIENT_ID: 'client-id',
      GH_CLIENT_SECRET: 'client-secret',
      ...(overrides.env ?? {}),
    },
  });

  /**
   * Returns the job payload and the response of a mocked update
   * @param context
   * @param info
   * @return {Promise<Response>}
   */
  async function mockUpdate(context, info, transient) {
    let data = null;

    sandbox.stub(Job, 'create').callsFake((ctx, inf, topic, opts) => {
      assert.strictEqual(topic, 'code');
      if (transient) {
        assert.equal(opts.transient, transient);
      }
      data = opts.data;
      return new Response('');
    });

    const result = await update(context, info);
    return {
      result,
      data,
    };
  }

  it('request path update without installation it gives error', async () => {
    nock('https://api.github.com')
      .get('/repos/owner/repo/installation')
      .reply(404);

    const ctx = BOT_TEST_CONTEXT('/owner/repos/repo/code/ref/not/relevant');
    const info = createInfo('/owner/repos/repo/code/ref/not/relevant');
    await assert.rejects(update(ctx, info), new StatusCodeError('github bot not installed on repository.', 400));
  });

  it('request path update', async () => {
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

    const ctx = BOT_TEST_CONTEXT('/owner/repos/repo/code/ref/foo/bar.md');
    const info = createInfo('/owner/repos/repo/code/ref/foo/bar.md');
    const { result, data } = await mockUpdate(ctx, info);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(data, {
      branch: 'ref',
      changes: [
        {
          contentType: 'text/markdown; charset=utf-8',
          path: 'foo/bar.md',
          type: 'modified',
        },
      ],
      codeRef: 'ref',
      codeRepo: 'repo',
      codeOwner: 'owner',
      codePrefix: '/owner/repo/ref/',
      installationId: 42,
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
    });
  });

  it('request path update (byogit)', async () => {
    nock('https://ny-github.com')
      .get('/code-owner/code-repo/rate_limit')
      .reply(500);
    const info = createInfo('/owner/repos/repo/code/ref/foo/bar.md')
      .withCode('owner', 'repo');

    const ctx = BOT_TEST_CONTEXT('/owner/repos/repo/code/ref/foo/bar.md', {
      attributes: {
        config: {
          ...SITE_CONFIG,
          code: {
            source: {
              type: 'github',
              url: 'https://ny-github.com/code-owner/code-repo',
              raw_url: 'https://raw.my-github.com',
            },
            owner: 'owner',
            repo: 'repo',
          },
        },
      },
    });
    const { result, data } = await mockUpdate(ctx, info);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(data, {
      branch: 'ref',
      changes: [
        {
          contentType: 'text/markdown; charset=utf-8',
          path: 'foo/bar.md',
          type: 'modified',
        },
      ],
      codeRef: 'ref',
      codeRepo: 'repo',
      codeOwner: 'owner',
      codePrefix: '/owner/repo/ref/',
      deploymentAllowed: false,
      installationId: 'byogit',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
    });
  });

  it('request path update (byogit w/ source owner/repo)', async () => {
    nock('https://ny-github.com')
      .get('/code-owner/code-repo/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

    const ctx = BOT_TEST_CONTEXT('/owner/repos/repo/code/ref/foo/bar.md', {
      attributes: {
        config: {
          ...SITE_CONFIG,
          code: {
            source: {
              type: 'github',
              url: 'https://ny-github.com/code-owner/code-repo',
              raw_url: 'https://raw.my-github.com',
              owner: 'owner',
              repo: 'repo',
            },
            owner: 'code-owner',
            repo: 'code-repo',
          },
        },
      },
    });
    const info = createInfo('/owner/repos/repo/code/ref/foo/bar.md')
      .withCode('owner', 'repo');
    const { result, data } = await mockUpdate(ctx, info);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(data, {
      branch: 'ref',
      changes: [
        {
          contentType: 'text/markdown; charset=utf-8',
          path: 'foo/bar.md',
          type: 'modified',
        },
      ],
      codeRef: 'ref',
      codeRepo: 'code-repo',
      codeOwner: 'code-owner',
      codePrefix: '/code-owner/code-repo/ref/',
      deploymentAllowed: false,
      installationId: 'byogit',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
    });
  });

  it('request branch update', async () => {
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

    const info = createInfo('/owner/repos/repo/code/ref/*')
      .withCode('owner', 'repo');
    const { result, data } = await mockUpdate(BOT_TEST_CONTEXT(), info);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(data, {
      branch: 'ref',
      changes: [{ contentType: null, path: '*', type: 'modified' }],
      codeRef: 'ref',
      codeRepo: 'repo',
      codeOwner: 'owner',
      codePrefix: '/owner/repo/ref/',
      installationId: 42,
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
    });
  });

  it('rate limits exceeded', async () => {
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, {
        resources: {
          core: {
            limit: 5000, used: 5000, remaining: 0, reset: 1625731200,
          },
        },
      });

    const info = createInfo('/owner/repos/repo/code/ref/*')
      .withCode('owner', 'repo');
    const { result } = await mockUpdate(BOT_TEST_CONTEXT(), info);
    assert.strictEqual(result.status, 429);
    assert.deepStrictEqual(result.headers.raw(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': 'Thu, 08 Jul 2021 08:00:00 GMT',
      'x-error': 'GitHub API rate limit exceeded for owner/repo: 5000/5000',
    });
  });

  it('request branch delete', async () => {
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

    const info = createInfo('/owner/repos/repo/code/ref/*', {}, 'DELETE')
      .withCode('owner', 'repo');
    const { result, data } = await mockUpdate(BOT_TEST_CONTEXT(), info);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(data, {
      branch: 'ref',
      changes: [{ contentType: null, path: '*', type: 'deleted' }],
      codeRef: 'ref',
      codeRepo: 'repo',
      codeOwner: 'owner',
      codePrefix: '/owner/repo/ref/',
      installationId: 42,
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
    });
  });

  it('ignore branch update on invalid path', async () => {
    const info = createInfo('/owner/repos/repo/code/ref/invalid folder/*', {}, 'DELETE')
      .withCode('owner', 'repo');
    const { result } = await mockUpdate(BOT_TEST_CONTEXT(), info);
    assert.strictEqual(result.status, 404);
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unsupported characters in path',
    });
  });

  it('ignore branch recursive update for non-root path', async () => {
    const info = createInfo('/owner/repos/repo/code/ref/non-root-folder/*', {}, 'DELETE')
      .withCode('owner', 'repo');
    const { result } = await mockUpdate(BOT_TEST_CONTEXT(), info);
    assert.strictEqual(result.status, 400);
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Recursive updates are only supported for root path.',
    });
  });

  it('payload branch update', async () => {
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

    const ctx = BOT_TEST_CONTEXT('/owner/repos/repo/code/ref', {
      attributes: {
        authInfo: AuthInfo.Default(),
      },
      data: {
        branch: 'ref',
        ref: 'ref',
        installationId: 42,
        changes: [
          {
            path: '*',
            type: 'added',
          },
        ],
      },
    });
    const info = createInfo('/owner/repos/repo/code/ref', {}, 'POST')
      .withCode('owner', 'repo');
    const { result, data } = await mockUpdate(ctx, info);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(data, {
      branch: 'ref',
      changes: [{ path: '*', type: 'added' }],
      codeRef: 'ref',
      codeRepo: 'repo',
      codeOwner: 'owner',
      codePrefix: '/owner/repo/ref/',
      deploymentAllowed: false,
      installationId: 42,
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
    });
  });

  it('payload branch update with code:write permissions', async () => {
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

    const ctx = BOT_TEST_CONTEXT('/owner/repos/repo/code/ref', {
      attributes: {
        authInfo: AuthInfo.Admin(),
      },
      data: {
        branch: 'ref',
        ref: 'ref',
        installationId: 42,
        changes: [
          {
            path: '*',
            type: 'added',
          },
        ],
      },
    });
    const info = createInfo('/owner/repos/repo/code/ref', {}, 'POST')
      .withCode('owner', 'repo');
    const { result, data } = await mockUpdate(ctx, info);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(data, {
      branch: 'ref',
      changes: [{ path: '*', type: 'added' }],
      codeRef: 'ref',
      codeRepo: 'repo',
      codeOwner: 'owner',
      codePrefix: '/owner/repo/ref/',
      deploymentAllowed: true,
      installationId: 42,
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
    });
  });

  it('handles repo and branches with unsupported characters correctly', async () => {
    nock.botInstallation(995843, 'owner', 'TEST-42');
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

    const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-sb.json'), 'utf-8'));
    events.repo = 'TEST-42';
    const ctx = BOT_TEST_CONTEXT('/owner/repos/test-42/code/ref', {
      data: events,
      attributes: {
        config: {
          ...SITE_CONFIG,
          code: {
            source: {
              type: 'github',
              url: 'https://github.com/owner/TEST-42',
            },
            owner: 'owner',
            repo: 'test-42',
          },
        },
      },
    });
    const info = createInfo('/owner/repos/test-42/code/ref', {}, 'POST')
      .withCode('owner', 'test-42');
    const { result, data } = await mockUpdate(ctx, info);
    assert.strictEqual(result.status, 200);
    delete data.changes;
    assert.deepStrictEqual(data, {
      baseRef: '',
      branch: 'tripod/test_@34/SUB',
      codeRef: 'tripod-test-34-sub',
      codeRepo: 'test-42',
      codeOwner: 'owner',
      codePrefix: '/owner/test-42/tripod-test-34-sub/',
      deploymentAllowed: true,
      installationId: 995843,
      owner: 'owner',
      ref: 'tripod/test_@34/SUB',
      repo: 'TEST-42',
      type: 'github',
    });
  });

  it('handles branches with uppercase', async () => {
    nock.botInstallation(995843);
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

    const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-uc.json'), 'utf-8'));
    const ctx = BOT_TEST_CONTEXT('/owner/repos/test-42/code/ref', {
      data: events,
    });

    const info = createInfo('/owner/repos/test-42/code/ref', {}, 'POST')
      .withCode('owner', 'repo');
    const { result, data } = await mockUpdate(ctx, info);
    assert.strictEqual(result.status, 200);
    delete data.changes;
    assert.deepStrictEqual(data, {
      baseRef: '',
      branch: 'MAIN',
      codeRef: 'main',
      codeOwner: 'owner',
      codeRepo: 'repo',
      codePrefix: '/owner/repo/main/',
      deploymentAllowed: true,
      installationId: 995843,
      owner: 'owner',
      ref: 'main',
      repo: 'repo',
      type: 'github',
    });
  });

  it('payload installation id must match', async () => {
    nock('https://api.github.com')
      .get('/repos/owner/repo/installation')
      .reply(200, { id: 42 });
    const ctx = BOT_TEST_CONTEXT('/owner/repos/repo/code/ref', {
      data: {
        installationId: 41,
        changes: [{ path: '*', type: 'added' }],
      },
    });
    const info = createInfo('/owner/repos/test-42/code/ref', {}, 'POST')
      .withCode('owner', 'repo');
    await assert.rejects(mockUpdate(ctx, info), new StatusCodeError('event installation id does not match repository installation id', 400));
  });
});
