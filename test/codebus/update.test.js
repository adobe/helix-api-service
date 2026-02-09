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
import esmock from 'esmock';
import { Request, Response } from '@adobe/fetch';
import { promises as fs } from 'fs';
import path from 'path';
import { update } from '../../src/codebus/update.js';
import {
  createPathInfo, DEFAULT_CONTEXT, Nock, SITE_CONFIG, main,
} from '../utils.js';
import { StatusCodeError } from '../../src/support/StatusCodeError.js';
import { applyConfig } from '../../src/config/utils.js';

const getKeyPair = promisify(generateKeyPair);

const FSTAB = `
mountpoints:
  /: https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg
`;

const TEST_CONTEXT = () => DEFAULT_CONTEXT({ githubToken: 'foo-token' });

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

  beforeEach(async () => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  const BOT_TEST_CONTEXT = (overrides = {}) => DEFAULT_CONTEXT({
    ...overrides,
    env: {
      GH_APP_ID: '1234',
      GH_APP_PRIVATE_KEY: privateKey,
      GH_CLIENT_ID: 'client-id',
      GH_CLIENT_SECRET: 'client-secret',
      ...(overrides.env ?? {}),
    },
  });

  const TEST_INFO = (p) => ({
    owner: 'owner',
    org: 'org',
    site: 'site',
    repo: 'repo',
    ref: 'ref',
    branch: 'ref',
    path: p,
    rawPath: p,
    resourcePath: p,
  });

  /**
   * Returns the job payload and the response of a mocked update
   * @param context
   * @param info
   * @return {Promise<Response>}
   */
  async function mockUpdate(context, info, transient) {
    let data = null;
    const { update: updateProxy } = await esmock('../../src/codebus/update.js', {
      '../../src/job/job.js': {
        Job: {
          create(ctx, inf, topic, opts) {
            assert.strictEqual(topic, 'code');
            if (transient) {
              assert.equal(opts.transient, transient);
            }
            data = opts.data;
            return new Response('');
          },
        },
      },
    });

    const result = await updateProxy(context, info);
    return {
      result,
      data,
    };
  }

  it('request path update without installation it gives error', async () => {
    await assert.rejects(update(TEST_CONTEXT(), createPathInfo('/preview/owner/repo/ref/not/relevant')), new StatusCodeError('using github token needs installation id.', 400));
  });

  it('request path update with no github token (no installation)', async () => {
    nock('https://api.github.com')
      .get('/repos/owner/repo/installation')
      .reply(404);
    await assert.rejects(update(BOT_TEST_CONTEXT(), {
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      path: '/foo/bar.md',
      rawPath: '/foo/bar.md',
    }), new StatusCodeError('github bot not installed on repository.', 400));
  });

  it('request path update', async () => {
    nock.fstab();
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const { result, data } = await mockUpdate(BOT_TEST_CONTEXT(), TEST_INFO('/foo/bar.md'));
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

  it('request path update (no fstab, config only)', async () => {
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const ctx = BOT_TEST_CONTEXT();
    const info = TEST_INFO('/foo/bar.md');
    applyConfig(ctx, info, SITE_CONFIG);
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
    const ctx = DEFAULT_CONTEXT({
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
    nock.fstab();
    nock('https://ny-github.com')
      .get('/code-owner/code-repo/rate_limit')
      .reply(500);
    const { result, data } = await mockUpdate(ctx, TEST_INFO('/foo/bar.md'));
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
    const ctx = DEFAULT_CONTEXT({
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
    nock.fstab();
    nock('https://ny-github.com')
      .get('/code-owner/code-repo/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const { result, data } = await mockUpdate(ctx, TEST_INFO('/foo/bar.md'));
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

  it('request path update (external)', async () => {
    nock.fstab();
    nock('https://my-api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const ctx = BOT_TEST_CONTEXT({
      env: {
        GH_BASE_URL: 'https://my-api.github.com',
        GH_EXTERNAL: true,
      },
      data: {
        installationId: 42,
      },
    });
    ctx.githubToken = 'my-token';
    const { result, data } = await mockUpdate(ctx, TEST_INFO('/foo/bar.md'), true);
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
      ref: 'ref',
      repo: 'repo',
      owner: 'owner',
    });
  });

  it('request branch update', async () => {
    nock.fstab();
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const { result, data } = await mockUpdate(BOT_TEST_CONTEXT(), TEST_INFO('/*'));
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
    nock.fstab();
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
    const { result } = await mockUpdate(BOT_TEST_CONTEXT(), TEST_INFO('/*'));
    assert.strictEqual(result.status, 429);
    assert.deepStrictEqual(result.headers.raw(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': 'Thu, 08 Jul 2021 08:00:00 GMT',
      'x-error': 'GitHub API rate limit exceeded for owner/repo: 5000/5000',
    });
  });

  it('request branch delete', async () => {
    nock.fstab();
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const info = TEST_INFO('/*');
    info.method = 'DELETE';
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
    const { result } = await mockUpdate(BOT_TEST_CONTEXT(), TEST_INFO('/invalid folder/*'));
    assert.strictEqual(result.status, 404);
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unsupported characters in path',
    });
  });

  it('ignore branch recursive update for non-root path', async () => {
    const { result } = await mockUpdate(BOT_TEST_CONTEXT(), TEST_INFO('/non-root-folder/*'));
    assert.strictEqual(result.status, 400);
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Recursive updates are only supported for root path.',
    });
  });

  it('payload branch update', async () => {
    const ctx = {
      ...DEFAULT_CONTEXT({ githubToken: 'foo-bar' }),
      data: {
        installationId: 42,
        changes: [
          {
            path: '*',
            type: 'added',
          },
        ],
      },
    };
    nock.fstab();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const { result, data } = await mockUpdate(ctx, TEST_INFO('/'));
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
    const ctx = {
      ...DEFAULT_CONTEXT({
        githubToken: 'foo-bar',
        attributes: {
          authInfo: {
            hasPermissions: (p) => p === 'code:write',
          },
        },
      }),
      data: {
        installationId: 42,
        changes: [
          {
            path: '*',
            type: 'added',
          },
        ],
      },
    };
    nock.fstab();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const { result, data } = await mockUpdate(ctx, TEST_INFO('/'));
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
    const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'codebus', 'fixtures', 'events-sb.json'), 'utf-8'));
    events.repo = 'TEST-42';
    const ctx = {
      ...DEFAULT_CONTEXT({ githubToken: 'foo-bar' }),
      data: events,
    };
    nock.fstab();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const { result, data } = await mockUpdate(ctx, TEST_INFO('/'));
    assert.strictEqual(result.status, 200);
    delete data.changes;
    assert.deepStrictEqual(data, {
      baseRef: '',
      branch: 'tripod/test_@34/SUB',
      codeRef: 'tripod-test-34-sub',
      codeRepo: 'test-42',
      codeOwner: 'owner',
      codePrefix: '/owner/test-42/tripod-test-34-sub/',
      deploymentAllowed: false,
      installationId: 995843,
      owner: 'owner',
      ref: 'tripod/test_@34/SUB',
      repo: 'TEST-42',
      type: 'github',
    });
  });

  it('handles branches with uppercase', async () => {
    const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'codebus', 'fixtures', 'events-uc.json'), 'utf-8'));
    const ctx = {
      ...DEFAULT_CONTEXT({ githubToken: 'foo-bar' }),
      data: events,
    };
    nock.fstab();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const { result, data } = await mockUpdate(ctx, TEST_INFO('/'));
    assert.strictEqual(result.status, 200);
    delete data.changes;
    assert.deepStrictEqual(data, {
      baseRef: '',
      branch: 'MAIN',
      codeRef: 'main',
      codeOwner: 'owner',
      codeRepo: 'repo',
      codePrefix: '/owner/repo/main/',
      deploymentAllowed: false,
      installationId: 995843,
      owner: 'owner',
      ref: 'main',
      repo: 'repo',
      type: 'github',
    });
  });

  it('payload installation id must match', async () => {
    const ctx = {
      ...BOT_TEST_CONTEXT(),
      data: {
        installationId: 41,
        changes: [{ path: '*', type: 'added' }],
      },
    };
    nock('https://api.github.com')
      .get('/repos/owner/repo/installation')
      .reply(200, { id: 42 });
    await assert.rejects(mockUpdate(ctx, TEST_INFO('/')), new StatusCodeError('event installation id does not match repository installation id', 400));
  });

  it('update ignored if no fstab', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/repo/main/fstab.yaml?x-id=GetObject')
      .reply(404);
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .reply(404);

    nock.botInstallation();
    const result = await update(BOT_TEST_CONTEXT(), TEST_INFO('/*'));
    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.headers.get('x-error'), 'code-action update ignored for project w/o fstab: owner/repo');
  });

  it('update enforces branch sync if fstab only in github', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/repo/main/fstab.yaml?x-id=GetObject')
      .reply(404);
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .reply(200, FSTAB);
    nock.botInstallation();
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const { result, data } = await mockUpdate(BOT_TEST_CONTEXT(), TEST_INFO('/'));
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(data, {
      branch: 'ref',
      changes: [
        {
          path: '*',
          type: 'modified',
        },
      ],
      codeRef: 'ref',
      codeOwner: 'owner',
      codeRepo: 'repo',
      codePrefix: '/owner/repo/ref/',
      installationId: 42,
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
    });
  });

  it('update uses github coordinates from config', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/repo/main/fstab.yaml?x-id=GetObject')
      .reply(404);
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .reply(200, FSTAB);
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    nock.botInstallation(42, 'OWNER', 'repo_42');
    const { result, data } = await mockUpdate(BOT_TEST_CONTEXT({
      attributes: {
        config: {
          ...SITE_CONFIG,
          code: {
            owner: 'owner',
            repo: 'repo-42',
            source: {
              type: 'github',
              url: 'https://github.com/OWNER/repo_42',
            },
          },
        },
      },
    }), TEST_INFO('/'));
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(data, {
      branch: 'ref',
      changes: [
        {
          path: '*',
          type: 'modified',
        },
      ],
      codeRef: 'ref',
      codeOwner: 'owner',
      codeRepo: 'repo-42',
      codePrefix: '/owner/repo-42/ref/',
      installationId: 42,
      owner: 'OWNER',
      ref: 'ref',
      repo: 'repo_42',
    });
  });

  it('update enforces branch sync if fstab only in github on special repo', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/test-42/main/fstab.yaml?x-id=GetObject')
      .reply(404)
      .get('/owner/TEST_42/main/fstab.yaml?x-id=GetObject')
      .reply(404);
    nock('https://raw.githubusercontent.com')
      .get('/owner/test-42/main/fstab.yaml')
      .reply(404)
      .get('/owner/TEST_42/main/fstab.yaml')
      .reply(200, FSTAB);

    nock.botInstallation(42, 'owner', 'TEST_42');
    nock('https://api.github.com')
      .get('/rate_limit')
      .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
    const info = TEST_INFO('/');
    info.repo = 'test-42';
    const { result, data } = await mockUpdate(BOT_TEST_CONTEXT({
      data: {
        owner: 'owner',
        repo: 'TEST_42',
        ref: 'ref',
        tag: 'true',
      },
    }), info);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(data, {
      branch: 'ref',
      changes: [
        {
          path: '*',
          type: 'modified',
        },
      ],
      codeRef: 'ref',
      codeOwner: 'owner',
      codeRepo: 'test-42',
      codePrefix: '/owner/test-42/ref/',
      installationId: 42,
      owner: 'owner',
      ref: 'ref',
      repo: 'TEST_42',
      tag: true,
    });
  });

  it('job handler: tries to get contentbus id via github bot', async () => {
    nock.config(null);
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/repo/main/helix-config.json?x-id=GetObject')
      .reply(404)
      .get('/owner/repo/main/fstab.yaml?x-id=GetObject')
      .reply(404)
      .get('/owner/repo/.helix/admin-jobs/code/job-24.json?x-id=GetObject')
      .reply(404)
      .get('/owner/repo/.helix/admin-jobs/code/incoming/job-24.json?x-id=GetObject')
      .reply(404);
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .reply(200, FSTAB);
    nock.botInstallation();
    const result = await main(new Request('https://admin.hlx.page/'), {
      ...DEFAULT_CONTEXT({
        attributes: {
          contentBusId: undefined,
          projectConfig: undefined,
        },
      }),
      env: {
        GH_APP_ID: '1234',
        GH_APP_PRIVATE_KEY: privateKey,
        GH_CLIENT_ID: 'client-id',
        GH_CLIENT_SECRET: 'client-secret',
      },
      pathInfo: {
        suffix: '/job/owner/repo/ref/code/job-24',
      },
    });

    assert.strictEqual(result.status, 404);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('job handler: tries to get contentbus id via github bot (error)', async () => {
    nock.config(null);
    nock('https://api.github.com')
      .get('/repos/owner/repo/installation')
      .reply(404);
    const result = await main(new Request('https://admin.hlx.page/'), {
      ...DEFAULT_CONTEXT({ attributes: { contentBusId: null } }),
      env: {
        GH_APP_ID: '1234',
        GH_APP_PRIVATE_KEY: privateKey,
        GH_CLIENT_ID: 'client-id',
        GH_CLIENT_SECRET: 'client-secret',
      },
      pathInfo: {
        suffix: '/job/owner/repo/ref/code/job-24',
      },
    });

    assert.strictEqual(result.status, 404);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'github bot not installed on repository.',
      vary: 'Accept-Encoding',
    });
  });
});
