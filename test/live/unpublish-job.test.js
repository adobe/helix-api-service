/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { METADATA_JSON_PATH, PURGE_ALL_CONTENT_THRESHOLD, REDIRECTS_JSON_PATH } from '../../src/contentbus/contentbus.js';
import { UnpublishJob } from '../../src/live/unpublish-job.js';
import { UnpublishResource } from '../../src/live/UnpublishResource.js';
import { JobStorage } from '../../src/job/JobStorage.js';
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
 * Creates an UnpublishJob instance with stubs applied for isolated testing.
 */
const createJob = async (ctx, info, paths) => {
  const storage = await JobStorage.create(ctx, info, UnpublishJob);
  const job = new UnpublishJob(ctx, info, UnpublishJob.TOPIC, 'job-123', storage);
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
    if (stat.total !== undefined) {
      this.state.progress.total = stat.total;
    }
    if (stat.processed !== undefined) {
      this.state.progress.processed += stat.processed;
    }
    if (stat.failed !== undefined) {
      this.state.progress.failed += stat.failed;
    }
  };
  job.checkStopped = async function checkStopped() {
    return false;
  };
  job.audit = async function audit() {
    return true;
  };
  return job;
};

describe('UnpublishJob Tests', () => {
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

    ctx = createContext('/org/sites/site/live/*', {
      env: { HELIX_STORAGE_DISABLE_R2: 'true' },
      attributes: {
        authInfo: AuthInfo.Admin(),
        config: structuredClone(SITE_CONFIG),
        infoMarkerChecked: true,
        // bypass fetchExtendedIndex so it returns null without S3 calls
        indexConfig: null,
        // bypass hasSimpleSitemap check
        hasSimpleSitemap: false,
      },
    });
    info = createInfo('/org/sites/site/live/*');
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('has correct TOPIC', () => {
    assert.strictEqual(UnpublishJob.TOPIC, 'live-remove');
  });

  it('throws when resumed during collecting phase', async () => {
    const job = await createJob(ctx, info, []);
    job.state.data.phase = 'collecting';

    await assert.rejects(
      () => job.run(),
      /job cannot be resumed during the collecting phase/,
    );
  });

  it('runs job successfully for a single document', async () => {
    nock.content()
      // prepare: HEAD on live partition — resource exists
      .headObject('/live/documents/document.md')
      .reply(200, '', { 'last-modified': 'Thu, 01 Jan 2023 00:00:00 GMT' })
      // contentbusRemove: HEAD metadata check (no redirect-location), then DELETE
      .headObject('/live/documents/document.md')
      .reply(404)
      .deleteObject('/live/documents/document.md')
      .reply(204);

    const job = await createJob(ctx, info, [{ path: '/documents/document' }]);
    sandbox.stub(job, 'index').resolves();
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(job.state.data.resources.length, 1);
    assert.strictEqual(job.state.data.resources[0].status, 204);
    assert.strictEqual(job.state.progress.total, 1);
  });

  it('skips resource not found on live during prepare', async () => {
    nock.content()
      .headObject('/live/topics/topic1.md')
      .reply(404);

    nock('https://sns.us-east-1.amazonaws.com:443')
      .post('/')
      .optionally(true)
      .reply(200, SNS_RESPONSE_BODY);

    const job = await createJob(ctx, info, [{ path: '/topics/topic1' }]);
    sandbox.stub(job, 'index').resolves();
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(job.state.data.resources.length, 0);
    assert.strictEqual(job.state.progress.total, 0);
  });

  it('records error and continues when contentbusRemove fails', async () => {
    nock.content()
      .headObject('/live/documents/document.md')
      .reply(200, '', { 'last-modified': 'Thu, 01 Jan 2023 00:00:00 GMT' })
      .headObject('/live/documents/document.md')
      .reply(404)
      .deleteObject('/live/documents/document.md')
      .reply(500);

    const job = await createJob(ctx, info, [{ path: '/documents/document' }]);
    sandbox.stub(job, 'index').resolves();
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    const resource = job.state.data.resources[0];
    assert.ok(resource.status !== 204, 'resource should not be marked as deleted');
  });

  it('runs job successfully for a prefix path (listing live partition)', async () => {
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/live/documents/`, [
      { Key: 'document.md', LastModified: '2023-10-06T08:05:00.000Z' },
    ], '');
    nock.content()
      .headObject('/live/documents/document.md')
      .reply(404) // contentbusRemove metadata check
      .deleteObject('/live/documents/document.md')
      .reply(204);

    const job = await createJob(ctx, info, [{ prefix: '/documents/' }]);
    sandbox.stub(job, 'index').resolves();
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(job.state.data.resources.length, 1);
    assert.strictEqual(job.state.data.resources[0].status, 204);
  });

  it('excludes metadata, redirects, .helix, and .snapshots paths during prepare', async () => {
    sandbox.stub(purge, 'content').resolves();

    const job = await createJob(ctx, info, [
      { path: METADATA_JSON_PATH },
      { path: REDIRECTS_JSON_PATH },
      { path: '/.helix/config.json' },
      { path: '/.snapshots/abc/doc' },
    ]);
    sandbox.stub(job, 'index').resolves();
    await job.run();

    assert.strictEqual(job.state.data.resources.length, 0);
    assert.strictEqual(job.state.data.phase, 'completed');
  });

  it('uses purge-all when more than PURGE_ALL_CONTENT_THRESHOLD resources are removed', async () => {
    const count = PURGE_ALL_CONTENT_THRESHOLD + 1;
    const paths = Array.from({ length: count }, (_, i) => ({ path: `/documents/doc${String(i).padStart(4, '0')}` }));

    const content = nock.content();
    for (let i = 0; i < count; i += 1) {
      const key = `/documents/doc${String(i).padStart(4, '0')}`;
      content
        .headObject(`/live${key}.md`)
        .reply(200, '', { 'last-modified': 'Thu, 01 Jan 2023 00:00:00 GMT' })
        .headObject(`/live${key}.md`)
        .reply(404)
        .deleteObject(`/live${key}.md`)
        .reply(204);
    }

    const job = await createJob(ctx, info, paths);
    sandbox.stub(job, 'index').resolves();
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.deepStrictEqual(purgeInfos, [{ key: CONTENT_BUS_ID }]);
  });

  it('stops job when stop signal received during processing', async () => {
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/live/documents/`, [
      { Key: 'document.md', LastModified: '2023-10-06T08:05:00.000Z' },
    ], '');

    const job = await createJob(ctx, info, [{ prefix: '/documents/' }]);
    sandbox.stub(job, 'index').resolves();
    job.checkStopped = sinon.stub().resolves(true);
    await job.run();

    const doc = job.state.data.resources.find((r) => r.resourcePath === '/documents/document.md');
    assert.ok(!doc?.status);
  });

  it('prepare converts index.md and non-.md paths via toWebPath', async () => {
    nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/live/`, [
      { Key: 'folder/index.md', LastModified: '2023-01-01T00:00:00.000Z' },
      { Key: 'image.png', LastModified: '2023-01-01T00:00:00.000Z' },
    ], '');

    const job = await createJob(ctx, info, [{ prefix: '/' }]);
    const resources = await job.prepare([{ prefix: '/' }], CONTENT_BUS_ID, HelixStorage.fromContext(ctx).contentBus());

    const indexEntry = resources.find((r) => r.resourcePath === '/folder/index.md');
    assert.strictEqual(indexEntry.webPath, '/folder/');

    const imgEntry = resources.find((r) => r.resourcePath === '/image.png');
    assert.strictEqual(imgEntry.webPath, '/image.png');
  });

  it('calls index() with removed resources after deleting', async () => {
    nock.content()
      .headObject('/live/documents/document.md')
      .reply(200, '', { 'last-modified': 'Thu, 01 Jan 2023 00:00:00 GMT' })
      .headObject('/live/documents/document.md')
      .reply(404)
      .deleteObject('/live/documents/document.md')
      .reply(204);

    const job = await createJob(ctx, info, [{ path: '/documents/document' }]);
    const indexStub = sandbox.stub(job, 'index').resolves();

    await job.run();

    assert.ok(indexStub.calledOnce);
  });

  describe('index', () => {
    it('skips indexRemove when fetchExtendedIndex returns null', async () => {
      // indexConfig: null in context → fetchExtendedIndex returns null → no indexRemove call
      nock('https://sns.us-east-1.amazonaws.com:443')
        .post('/')
        .reply(200, SNS_RESPONSE_BODY);

      const job = await createJob(ctx, info, []);
      const resource = new UnpublishResource('/documents/doc.md', '/documents/doc');
      resource.setStatus(204);
      job.state.data.resources = [resource];

      await job.index();
    });

    it('calls indexRemove when an index config is available', async () => {
      // Override indexConfig to a minimal non-null object with empty indices
      // so loadIndexData and sendToQueue have nothing to process (no network calls)
      ctx.attributes.indexConfig = { indices: [], getErrors: () => [] };

      nock('https://sns.us-east-1.amazonaws.com:443')
        .post('/')
        .reply(200, SNS_RESPONSE_BODY);

      const job = await createJob(ctx, info, []);
      const resource = new UnpublishResource('/documents/doc.md', '/documents/doc');
      resource.setStatus(204);
      job.state.data.resources = [resource];

      // Should complete without errors; the if (index) branch is exercised
      await job.index();
    });

    it('processes multiple resources concurrently', async () => {
      nock('https://sns.us-east-1.amazonaws.com:443')
        .post('/')
        .reply(200, SNS_RESPONSE_BODY);

      const job = await createJob(ctx, info, []);
      const resources = [
        new UnpublishResource('/a.md', '/a'),
        new UnpublishResource('/b.md', '/b'),
      ];
      resources.forEach((r) => r.setStatus(204));
      job.state.data.resources = resources;

      // indexConfig: null → fetchExtendedIndex returns null → no-op per resource
      await job.index();
    });
  });
});
