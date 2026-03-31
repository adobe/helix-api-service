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
import xml2js from 'xml2js';
import sinon from 'sinon';

import { HelixStorage } from '@adobe/helix-shared-storage';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { METADATA_JSON_PATH, PURGE_ALL_CONTENT_THRESHOLD, REDIRECTS_JSON_PATH } from '../../src/contentbus/contentbus.js';
import { RemoveJob } from '../../src/preview/remove-job.js';
import { JobStorage } from '../../src/job/storage.js';
import purge from '../../src/cache/purge.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

const CONTENT_BUS_ID = SITE_CONFIG.content.contentBusId;

const SNS_RESPONSE_BODY = new xml2js.Builder().buildObject({
  PublishResponse: {
    PublishResult: {
      SequenceNumber: '1',
      MessageId: '1',
    },
  },
});

/**
 * Creates a RemoveJob instance with stubs applied for isolated testing.
 */
const createJob = async (ctx, info, paths) => {
  const storage = await JobStorage.create(ctx, info, RemoveJob);
  const job = new RemoveJob(ctx, info, RemoveJob.TOPIC, 'job-123', storage);
  job.state = {
    data: { paths },
    progress: {
      total: 0,
      processed: 0,
      failed: 0,
    },
  };

  job.writeState = function writeState(s = this.state) {
    this.state = s;
    this.lastSaveTime = Date.now();
  };
  job.writeStateLazy = async function writeStateLazy() { /* no-op */ };
  job.setPhase = async function setPhase(phase) {
    this.state.data.phase = phase;
  };
  job.trackProgress = async function trackProgress(stat) {
    if (stat.total !== undefined) this.state.progress.total = stat.total;
    if (stat.processed !== undefined) this.state.progress.processed += stat.processed;
    if (stat.failed !== undefined) this.state.progress.failed += stat.failed;
  };
  job.checkStopped = async function checkStopped() {
    return false;
  };
  job.audit = async function audit() {
    return true;
  };
  return job;
};

describe('RemoveJob Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  let ctx;
  let info;
  let purgeInfos;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();

    purgeInfos = [];
    sandbox.stub(purge, 'perform').callsFake((c, i, infos) => {
      purgeInfos.push(...infos);
    });

    ctx = createContext('/org/sites/site/preview/*', {
      env: { HELIX_STORAGE_DISABLE_R2: 'true' },
      attributes: {
        authInfo: AuthInfo.Admin(),
        config: structuredClone(SITE_CONFIG),
        infoMarkerChecked: true,
      },
    });
    info = createInfo('/org/sites/site/preview/*');
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('runs job successfully', async () => {
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/preview/documents/`, [
      { Key: 'document.md', LastModified: '2023-10-06T08:05:00.000Z' },
    ], '');
    nock.content()
      // HEAD for single path /topics/topic1 → not found (prepare)
      .headObject('/preview/topics/topic1.md')
      .reply(404)
      // HEAD for single path /topics/topic2 → found (prepare)
      .headObject('/preview/topics/topic2.md')
      .reply(200, '', { 'last-modified': 'Thu, 01 Jan 1970 00:00:00 GMT' })
      // HEAD for document metadata check (contentbusRemove) → no redirect
      .headObject('/preview/documents/document.md')
      .reply(404)
      // DELETE for document
      .deleteObject('/preview/documents/document.md')
      .reply(204)
      // HEAD for topic2 metadata check (contentbusRemove) → no redirect
      .headObject('/preview/topics/topic2.md')
      .reply(404)
      // DELETE for topic2 → fails
      .deleteObject('/preview/topics/topic2.md')
      .reply(500);

    // SNS notification
    nock('https://sns.us-east-1.amazonaws.com:443')
      .post('/')
      .reply((_, body) => {
        const params = new URLSearchParams(body);
        const msg = JSON.parse(params.get('Message'));
        assert.strictEqual(msg.op, 'resources-unpreviewed');
        assert.deepStrictEqual(msg.result.resourcePaths, ['/documents/document.md']);
        assert.strictEqual(msg.result.errors.length, 1);
        assert.strictEqual(msg.result.errors[0].path, '/topics/topic2');
        return [200, SNS_RESPONSE_BODY];
      });

    const job = await createJob(ctx, info, [
      { prefix: '/documents/' },
      { path: '/topics/topic1' },
      { path: '/topics/topic2' },
      { path: METADATA_JSON_PATH },
      { path: REDIRECTS_JSON_PATH },
      { path: '/.helix/config.json' },
    ]);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(job.state.data.resources.length, 2);
    assert.strictEqual(job.state.data.resources[0].status, 204);
    assert.ok(!job.state.data.resources[1].ok); // topic2 delete failed
    assert.deepStrictEqual(purgeInfos, [
      { key: 'p_eI7cO88L3yedH2Zt' },
      { path: '/documents/document' },
    ]);
  });

  it('uses purge-all for large jobs', async () => {
    const count = PURGE_ALL_CONTENT_THRESHOLD + 10;
    const paths = Array.from({ length: count }, (_, i) => ({ path: `/documents/doc${String(i).padStart(4, '0')}` }));

    const content = nock.content();
    for (let i = 0; i < count; i += 1) {
      const key = `/documents/doc${String(i).padStart(4, '0')}`;
      content
        // HEAD for prepare (single-path existence check)
        .headObject(`/preview${key}.md`)
        .reply(200, '', { 'last-modified': 'Thu, 01 Jan 1970 00:00:00 GMT' })
        // HEAD for contentbusRemove metadata check (no redirect-location)
        .headObject(`/preview${key}.md`)
        .reply(404)
        .deleteObject(`/preview${key}.md`)
        .reply(204);
    }
    nock('https://sns.us-east-1.amazonaws.com:443')
      .post('/')
      .reply(200, SNS_RESPONSE_BODY);

    const job = await createJob(ctx, info, paths);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.deepStrictEqual(purgeInfos, [
      { key: 'p_853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f' },
    ]);
  });

  it('stops job when stop signal received during processing', async () => {
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/preview/documents/`, [
      { Key: 'document.md', LastModified: '2023-10-06T08:05:00.000Z' },
    ], '');
    nock('https://sns.us-east-1.amazonaws.com:443')
      .post('/')
      .reply(200, SNS_RESPONSE_BODY);

    const job = await createJob(ctx, info, [{ prefix: '/documents/' }]);
    // Simulate stop signal on first processResource call
    job.checkStopped = sinon.stub().resolves(true);
    await job.run();

    // stopped before processing, document should have no status set
    const doc = job.state.data.resources.find((r) => r.resourcePath === '/documents/document.md');
    assert.ok(!doc?.status);
  });

  it('prepare converts index.md and non-.md paths via toWebPath', async () => {
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/preview/`, [
      { Key: 'folder/index.md', LastModified: '2023-01-01T00:00:00.000Z' },
      { Key: 'image.png', LastModified: '2023-01-01T00:00:00.000Z' },
    ], '');

    const job = await createJob(ctx, info, [{ prefix: '/' }]);
    const resources = await job.prepare([{ prefix: '/' }], CONTENT_BUS_ID, HelixStorage.fromContext(ctx).contentBus());

    const indexEntry = resources.find((r) => r.resourcePath === '/folder/index.md');
    assert.strictEqual(indexEntry.path, '/folder/');

    const imgEntry = resources.find((r) => r.resourcePath === '/image.png');
    assert.strictEqual(imgEntry.path, '/image.png');
  });

  it('skips excluded paths (metadata, redirects, .helix) during prepare', async () => {
    sandbox.stub(purge, 'content').resolves();

    const job = await createJob(ctx, info, [
      { path: METADATA_JSON_PATH },
      { path: REDIRECTS_JSON_PATH },
      { path: '/.helix/config.json' },
    ]);
    await job.run();

    assert.strictEqual(job.state.data.resources.length, 0);
    assert.strictEqual(job.state.data.phase, 'completed');
  });
});
