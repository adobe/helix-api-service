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
import bulkPublish from '../../src/live/bulk-publish.js';
import { PublishJob } from '../../src/live/publish-job.js';
import { Job } from '../../src/job/job.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

function createTestContext(data) {
  return createContext('/org/sites/site/live/*', {
    attributes: {
      authInfo: AuthInfo.Admin(),
      config: structuredClone(SITE_CONFIG),
      infoMarkerChecked: true,
    },
    data,
  });
}

describe('Bulk Publish Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  let info;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
    info = createInfo('/org/sites/site/live/*');
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('returns 400 for missing payload', async () => {
    const context = createTestContext(undefined);
    const result = await bulkPublish(context, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), "bulk-publish payload is missing 'paths'.");
  });

  it('returns 400 for empty paths array', async () => {
    const context = createTestContext({ paths: [] });
    const result = await bulkPublish(context, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), "bulk-publish payload is missing 'paths'.");
  });

  it('returns 400 for invalid payload (not an array)', async () => {
    const context = createTestContext({ paths: '/foo' });
    const result = await bulkPublish(context, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), "bulk-publish 'paths' is not an array.");
  });

  it('returns 400 for illegal path (with spaces)', async () => {
    const context = createTestContext({ paths: ['/foo/my documents/bar'] });
    const result = await bulkPublish(context, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), 'bulk-publish path not valid: /foo/my documents/bar');
  });

  it('returns 400 for tree publish', async () => {
    const context = createTestContext({ paths: ['/foo/*'] });
    const result = await bulkPublish(context, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), 'bulk-publish does not support publishing of subtrees due to security reasons.');
  });

  it('returns 400 when paths exceed the sync limit', async () => {
    const context = createTestContext({ paths: Array.from({ length: 201 }, (_, i) => `/path-${i}`) });
    const result = await bulkPublish(context, info);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.headers.get('x-error'), 'Bulk path limit exceeded for this content source (201 > 200). Use forceAsync=true');
    assert.strictEqual(result.headers.get('x-error-code'), 'AEM_BACKEND_TOO_MANY_BULK_PATHS');
  });

  it('bypasses the sync limit when forceAsync=true', async () => {
    const context = createTestContext({
      paths: Array.from({ length: 201 }, (_, i) => `/path-${i}`),
      forceAsync: true,
    });
    const createStub = sandbox.stub(Job, 'create').resolves(new Response('', { status: 202 }));
    const result = await bulkPublish(context, info);
    assert.strictEqual(result.status, 202);
    assert.ok(createStub.calledOnce);
  });

  it('creates the job with correct topic, transient flag, and paths', async () => {
    const context = createTestContext({ paths: ['/foo/bar', '/bar'] });

    const createStub = sandbox.stub(Job, 'create').resolves(new Response('', { status: 202 }));

    const result = await bulkPublish(context, info);
    assert.strictEqual(result.status, 202);
    assert.ok(createStub.calledOnce);

    const [, , topic, opts] = createStub.firstCall.args;
    assert.strictEqual(topic, PublishJob.TOPIC);
    assert.strictEqual(opts.transient, true);
    assert.deepStrictEqual(opts.data, {
      paths: ['/foo/bar', '/bar'],
      forceUpdate: false,
    });
    assert.deepStrictEqual(opts.roles, ['author']);
  });

  it('passes forceUpdate=true when specified', async () => {
    const context = createTestContext({ paths: ['/foo/bar'], forceUpdate: 'true' });

    const createStub = sandbox.stub(Job, 'create').resolves(new Response('', { status: 202 }));

    await bulkPublish(context, info);
    assert.ok(createStub.calledOnce);

    const [, , , opts] = createStub.firstCall.args;
    assert.strictEqual(opts.data.forceUpdate, true);
  });
});
