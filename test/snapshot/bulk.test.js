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
import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { bulkSnapshot } from '../../src/snapshot/bulk-snapshot.js';
import { bulkRemove } from '../../src/snapshot/bulk-remove.js';
import { SnapshotJob } from '../../src/snapshot/SnapshotJob.js';
import { SnapshotRemoveJob } from '../../src/snapshot/SnapshotRemoveJob.js';
import { Job } from '../../src/job/Job.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

function createTestContext(data) {
  return createContext('/org/sites/site/snapshots/test-snap/*', {
    env: { HELIX_STORAGE_DISABLE_R2: 'true' },
    attributes: {
      authInfo: AuthInfo.Admin(),
      config: structuredClone(SITE_CONFIG),
      infoMarkerChecked: true,
    },
    data,
  });
}

describe('Bulk Snapshot Tests', () => {
  let nock;
  let sandbox;
  let info;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
    info = createInfo('/org/sites/site/snapshots/test-snap/*');
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('returns 400 for missing payload', async () => {
    const context = createTestContext(undefined);
    const result = await bulkSnapshot(context, info);
    assert.strictEqual(result.status, 400);
    assert.match(result.headers.get('x-error'), /missing 'paths'/);
  });

  it('returns 400 for empty paths array', async () => {
    const context = createTestContext({ paths: [] });
    const result = await bulkSnapshot(context, info);
    assert.strictEqual(result.status, 400);
  });

  it('returns 400 for invalid payload (not an array)', async () => {
    const context = createTestContext({ paths: '/foo' });
    const result = await bulkSnapshot(context, info);
    assert.strictEqual(result.status, 400);
    assert.match(result.headers.get('x-error'), /not an array/);
  });

  it('returns 400 for illegal path', async () => {
    const context = createTestContext({ paths: ['/foo/my documents/bar'] });
    const result = await bulkSnapshot(context, info);
    assert.strictEqual(result.status, 400);
    assert.match(result.headers.get('x-error'), /not valid/);
  });

  it('returns 400 when paths exceed the sync limit', async () => {
    const context = createTestContext({
      paths: Array.from({ length: 201 }, (_, i) => `/path-${i}`),
    });
    const result = await bulkSnapshot(context, info);
    assert.strictEqual(result.status, 400);
    assert.match(result.headers.get('x-error'), /Bulk path limit exceeded/);
  });

  it('bypasses the sync limit when forceAsync=true', async () => {
    const context = createTestContext({
      paths: Array.from({ length: 201 }, (_, i) => `/path-${i}`),
      forceAsync: 'true',
    });
    const createStub = sandbox.stub(Job, 'create').resolves(new Response('', { status: 200 }));
    const result = await bulkSnapshot(context, info);
    assert.strictEqual(result.status, 200);
    assert.ok(createStub.calledOnce);
  });

  it('creates the job with correct data', async () => {
    const context = createTestContext({ paths: ['/foo', '/bar'] });
    const createStub = sandbox.stub(Job, 'create').resolves(new Response('', { status: 200 }));
    await bulkSnapshot(context, info);

    assert.ok(createStub.calledOnce);
    const [, , topic, opts] = createStub.firstCall.args;
    assert.strictEqual(topic, 'snapshot');
    assert.strictEqual(opts.transient, true);
    assert.strictEqual(opts.jobClass, SnapshotJob);
    assert.strictEqual(opts.data.snapshotId, 'test-snap');
    assert.strictEqual(opts.data.forceUpdate, false);
    assert.deepStrictEqual(opts.data.paths, [{ path: '/foo' }, { path: '/bar' }]);
  });

  it('passes forceUpdate=true when specified', async () => {
    const context = createTestContext({ paths: ['/foo'], forceUpdate: 'true' });
    const createStub = sandbox.stub(Job, 'create').resolves(new Response('', { status: 200 }));
    await bulkSnapshot(context, info);

    const [, , , opts] = createStub.firstCall.args;
    assert.strictEqual(opts.data.forceUpdate, true);
  });

  it('returns 500 when Job.create throws unexpected error', async () => {
    const context = createTestContext({ paths: ['/foo'] });
    sandbox.stub(Job, 'create').rejects(new Error('unexpected'));
    const result = await bulkSnapshot(context, info);
    assert.strictEqual(result.status, 500);
  });

  it('re-throws AccessDeniedError', async () => {
    const { AccessDeniedError } = await import('../../src/auth/AccessDeniedError.js');
    const context = createTestContext({ paths: ['/foo'] });
    sandbox.stub(Job, 'create').rejects(new AccessDeniedError('denied'));
    await assert.rejects(() => bulkSnapshot(context, info), AccessDeniedError);
  });

  it('processes wildcard paths as prefix entries', async () => {
    const context = createTestContext({ paths: ['/docs/*', '/blog/post'] });
    const createStub = sandbox.stub(Job, 'create').resolves(new Response('', { status: 200 }));
    await bulkSnapshot(context, info);

    const [, , , opts] = createStub.firstCall.args;
    assert.deepStrictEqual(opts.data.paths, [
      { prefix: '/docs/' },
      { path: '/blog/post' },
    ]);
  });
});

describe('Bulk Snapshot Remove Tests', () => {
  let nock;
  let sandbox;
  let info;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
    info = createInfo('/org/sites/site/snapshots/test-snap/*');
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('returns 400 for missing payload', async () => {
    const context = createTestContext(undefined);
    const result = await bulkRemove(context, info);
    assert.strictEqual(result.status, 400);
    assert.match(result.headers.get('x-error'), /missing 'paths'/);
  });

  it('returns 400 for empty paths array', async () => {
    const context = createTestContext({ paths: [] });
    const result = await bulkRemove(context, info);
    assert.strictEqual(result.status, 400);
  });

  it('returns 400 for invalid payload (not an array)', async () => {
    const context = createTestContext({ paths: '/foo' });
    const result = await bulkRemove(context, info);
    assert.strictEqual(result.status, 400);
  });

  it('returns 400 for illegal path', async () => {
    const context = createTestContext({ paths: ['/foo/my documents/bar'] });
    const result = await bulkRemove(context, info);
    assert.strictEqual(result.status, 400);
  });

  it('returns 400 when paths exceed the sync limit', async () => {
    const context = createTestContext({
      paths: Array.from({ length: 201 }, (_, i) => `/path-${i}`),
    });
    const result = await bulkRemove(context, info);
    assert.strictEqual(result.status, 400);
    assert.match(result.headers.get('x-error'), /Bulk path limit exceeded/);
  });

  it('creates the job with correct data', async () => {
    const context = createTestContext({ paths: ['/foo', '/bar'] });
    const createStub = sandbox.stub(Job, 'create').resolves(new Response('', { status: 200 }));
    await bulkRemove(context, info);

    assert.ok(createStub.calledOnce);
    const [, , topic, opts] = createStub.firstCall.args;
    assert.strictEqual(topic, SnapshotRemoveJob.TOPIC);
    assert.strictEqual(opts.transient, true);
    assert.strictEqual(opts.jobClass, SnapshotRemoveJob);
    assert.strictEqual(opts.data.snapshotId, 'test-snap');
  });

  it('returns 500 when Job.create throws unexpected error', async () => {
    const context = createTestContext({ paths: ['/foo'] });
    sandbox.stub(Job, 'create').rejects(new Error('unexpected'));
    const result = await bulkRemove(context, info);
    assert.strictEqual(result.status, 500);
  });

  it('re-throws AccessDeniedError', async () => {
    const { AccessDeniedError } = await import('../../src/auth/AccessDeniedError.js');
    const context = createTestContext({ paths: ['/foo'] });
    sandbox.stub(Job, 'create').rejects(new AccessDeniedError('denied'));
    await assert.rejects(() => bulkRemove(context, info), AccessDeniedError);
  });
});
