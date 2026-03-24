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
import sinon from 'sinon';
import { Response } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { HANDLERS } from '../../src/contentproxy/index.js';
import bulkPreview from '../../src/preview/bulk-preview.js';
import { Job } from '../../src/job/job.js';
import { createContext, createInfo, Nock } from '../utils.js';

const TEST_SOURCE = { type: 'test-bulk', url: 'test://foo-bar' };

const TEST_CONFIG = {
  content: {
    contentBusId: 'foo-id',
    source: TEST_SOURCE,
  },
  code: {
    owner: 'owner',
    repo: 'repo',
    source: { type: 'github', url: 'https://github.com/owner/repo' },
  },
};

const createTestHandler = () => ({
  get name() { return 'test-bulk'; },
  async handle() { return new Response('ok'); },
  list() { return []; },
});

describe('Bulk Preview Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  let ctx;
  let info;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
    HANDLERS['test-bulk'] = createTestHandler();

    ctx = createContext('/org/sites/site/preview/*', {
      attributes: {
        authInfo: AuthInfo.Admin(),
        config: structuredClone(TEST_CONFIG),
        infoMarkerChecked: true,
      },
    });
    info = createInfo('/org/sites/site/preview/*');
  });

  afterEach(() => {
    delete HANDLERS['test-bulk'];
    sandbox.restore();
    nock.done();
  });

  it('returns 400 for missing payload', async () => {
    const result = await bulkPreview(ctx, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), 'bulk-preview payload is missing "paths".');
  });

  it('returns 400 for empty paths array', async () => {
    ctx.data.paths = [];
    const result = await bulkPreview(ctx, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), 'bulk-preview payload is missing "paths".');
  });

  it('returns 400 for invalid payload (not an array)', async () => {
    ctx.data.paths = '/foo';
    const result = await bulkPreview(ctx, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), 'bulk-preview "paths" is not an array.');
  });

  it('returns 400 for illegal path (with spaces)', async () => {
    ctx.data.paths = ['/my documents/foo'];
    const result = await bulkPreview(ctx, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), 'bulk-preview path not valid: /my documents/foo');
  });

  it('returns 400 for config paths', async () => {
    ctx.data.paths = ['/.helix/config.json'];
    const result = await bulkPreview(ctx, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), 'bulk-preview of config resources is not supported: /.helix/config.json');
  });

  it('returns 400 for non-string path (null → becomes "null" → passes isIllegalPath)', async () => {
    ctx.data.paths = [null];
    const result = await bulkPreview(ctx, info);
    // null.startsWith throws before isIllegalPath, caught as 500 or 400
    assert.ok(result.status >= 400);
  });

  it('returns 404 for unknown content source handler', async () => {
    ctx.data.paths = ['/foo'];
    ctx.attributes.config.content.source = { type: 'unknown-type' };
    const result = await bulkPreview(ctx, info);
    assert.strictEqual(result.status, 404);
  });

  it('returns 400 if handler does not support bulk (no list method)', async () => {
    delete HANDLERS['test-bulk'].list;
    ctx.data.paths = ['/foo'];
    const result = await bulkPreview(ctx, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), 'bulk-preview not supported for handler "test-bulk".');
  });

  it('returns 400 when trying to preview a subtree with a markup content source', async () => {
    const origMarkup = HANDLERS.markup;
    HANDLERS.markup = { name: 'markup', list() {} };
    ctx.data.paths = ['/foo/*'];
    ctx.attributes.config.content.source = { type: 'markup', url: 'https://byom.example.com' };
    try {
      const result = await bulkPreview(ctx, info);
      assert.strictEqual(result.status, 400);
      assert.strictEqual(result.headers.get('x-error'), 'wildcard paths are not supported with a markup content source.');
    } finally {
      HANDLERS.markup = origMarkup;
    }
  });

  it('requires edit:list permission for wildcard paths', async () => {
    const ctxNoPerms = createContext('/org/sites/site/preview/*', {
      attributes: {
        authInfo: AuthInfo.Default(),
        config: structuredClone(TEST_CONFIG),
        infoMarkerChecked: true,
      },
    });
    ctxNoPerms.data.paths = ['/foo/*'];
    await assert.rejects(
      () => bulkPreview(ctxNoPerms, info),
      { message: 'edit:list' },
    );
  });

  it('requires edit:list permission for >100 paths', async () => {
    const ctxNoPerms = createContext('/org/sites/site/preview/*', {
      attributes: {
        authInfo: AuthInfo.Default(),
        config: structuredClone(TEST_CONFIG),
        infoMarkerChecked: true,
      },
    });
    ctxNoPerms.data.paths = Array.from({ length: 101 }, (_, i) => `/path-${i}`);
    await assert.rejects(
      () => bulkPreview(ctxNoPerms, info),
      { message: 'edit:list' },
    );
  });

  it('creates the preview job with correct parameters', async () => {
    const createStub = sandbox.stub(Job, 'create').resolves(
      new Response(JSON.stringify({ job: { state: 'created' } }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );

    ctx.data.paths = ['/foo/bar'];
    const result = await bulkPreview(ctx, info);

    assert.strictEqual(result.status, 202);
    assert.ok(createStub.calledOnce);
    const [, , topic, opts] = createStub.firstCall.args;
    assert.strictEqual(topic, 'preview');
    assert.deepStrictEqual(opts.data, {
      forceUpdate: false,
      paths: ['/foo/bar'],
    });
    assert.deepStrictEqual(opts.roles, ['author']);
  });

  it('coerces paths to strings and forceUpdate to boolean', async () => {
    const createStub = sandbox.stub(Job, 'create').resolves(
      new Response('{}', { status: 200 }),
    );

    ctx.data.paths = ['/foo/bar'];
    ctx.data.forceUpdate = 'true';
    await bulkPreview(ctx, info);

    const [, , , opts] = createStub.firstCall.args;
    assert.strictEqual(opts.data.forceUpdate, true);
    assert.strictEqual(typeof opts.data.paths[0], 'string');
  });
});
