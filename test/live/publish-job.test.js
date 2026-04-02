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

import { AuthInfo } from '../../src/auth/auth-info.js';
import { METADATA_JSON_PATH, PURGE_ALL_CONTENT_THRESHOLD, REDIRECTS_JSON_PATH } from '../../src/contentbus/contentbus.js';
import { PublishJob } from '../../src/live/publish-job.js';
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
 * Successful S3 CopyObject response body.
 */
const COPY_XML = new xml2js.Builder().buildObject({
  CopyObjectResult: {
    ETag: '"abc123"',
    LastModified: '2023-10-06T08:05:00.000Z',
  },
});

const LAST_MODIFIED_PREVIEW = 'Thu, 01 Jan 2023 00:00:00 GMT';
const LAST_MODIFIED_LIVE_NEWER = 'Fri, 02 Jan 2023 00:00:00 GMT';

/**
 * Creates a PublishJob instance with stubbed lifecycle methods for isolated testing.
 */
const createJob = async (ctx, info, paths, { forceUpdate = false } = {}) => {
  const storage = await JobStorage.create(ctx, info, PublishJob);
  const job = new PublishJob(ctx, info, PublishJob.TOPIC, 'job-123', storage);
  job.state = {
    data: { paths, forceUpdate },
    progress: {
      total: 0,
      processed: 0,
      failed: 0,
      notmodified: 0,
      success: 0,
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
    for (const key of ['total', 'failed', 'notmodified', 'success']) {
      if (stat[key] !== undefined) {
        this.state.progress[key] = stat[key];
      }
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

describe('PublishJob Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  let ctx;
  let info;
  let purgeInfos;
  let notified;

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
        // pre-seed redirect cache so processRedirects first-call doesn't fetch from S3
        redirects: { live: {} },
        // bypass installSimpleSitemap (truthy sitemapConfig → returns early, no S3 calls)
        sitemapConfig: {},
        // bypass fetchExtendedIndex → addSimpleSitemapIndex (false → returns null, no indexUpdate)
        hasSimpleSitemap: false,
        // bypass fetchIndex so it returns null without a GET request for query.yaml
        indexConfig: null,
      },
    });
    info = createInfo('/org/sites/site/live/*');

    notified = 0;
    nock('https://sns.us-east-1.amazonaws.com:443')
      .post('/')
      .optionally(true)
      .reply((_, body) => {
        const params = new URLSearchParams(body);
        const msg = JSON.parse(params.get('Message'));
        assert.strictEqual(msg.op, 'resources-published');
        notified += 1;
        return [200, SNS_RESPONSE_BODY];
      });
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('runs job successfully for a single document', async () => {
    nock.content()
      // prepare: check preview exists
      .headObject('/preview/documents/document.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW })
      // isModified: live copy doesn't exist → publish
      .headObject('/live/documents/document.md')
      .reply(404)
      // contentBusCopy: storage.copy HEADs source for addMetadata, then copies
      .headObject('/preview/documents/document.md')
      .reply(200)
      .copyObject('/live/documents/document.md')
      .reply(200, COPY_XML)
      // publishStatus: getContentBusInfo HEADs live partition
      .headObject('/live/documents/document.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW, 'content-type': 'text/markdown' });

    const job = await createJob(ctx, info, ['/documents/document']);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(job.state.data.resources.length, 1);
    assert.strictEqual(job.state.data.resources[0].status, 200);

    assert.strictEqual(notified, 1);
  });

  it('skips a resource that is not modified on live', async () => {
    nock.content()
      .headObject('/preview/documents/document.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW })
      // isModified: live is newer than preview → skip
      .headObject('/live/documents/document.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_LIVE_NEWER });

    const job = await createJob(ctx, info, ['/documents/document']);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(job.state.data.resources[0].status, 304);
    assert.strictEqual(job.state.progress.notmodified, 1);
    assert.strictEqual(purgeInfos.length, 0, '304 resources should not be purged');
    // 304 resources are excluded from notification — no SNS
    assert.strictEqual(notified, 0);
  });

  it('marks resource as 404 when not found on preview during prepare', async () => {
    nock.content()
      .headObject('/preview/documents/document.md')
      .reply(404);

    const job = await createJob(ctx, info, ['/documents/document']);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(job.state.data.resources[0].status, 404);
    // failed counter is set during trackProgress from prepare (not from liveUpdate)
    assert.strictEqual(job.state.progress.failed, 1);
    // 404 resource is still purged and indexed (status !== 304), triggering a notification
    assert.strictEqual(notified, 1);
  });

  it('skips preview HEAD and isModified check when forceUpdate=true', async () => {
    nock.content()
      // no prepare HEAD (forceUpdate skips storage.head in prepare)
      // no isModified HEAD (forceUpdate bypasses isModified check)
      .headObject('/preview/documents/document.md')
      .reply(200) // storage.copy addMetadata
      .copyObject('/live/documents/document.md')
      .reply(200, COPY_XML)
      .headObject('/live/documents/document.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW, 'content-type': 'text/markdown' });

    const job = await createJob(ctx, info, ['/documents/document'], { forceUpdate: true });
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(job.state.data.resources[0].status, 200);
    assert.strictEqual(notified, 1);
  });

  it('records error and increments failed counter when liveUpdate fails', async () => {
    nock.content()
      .headObject('/preview/documents/document.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW })
      .headObject('/live/documents/document.md')
      .reply(404) // isModified
      .headObject('/preview/documents/document.md')
      .reply(200) // storage.copy addMetadata
      .copyObject('/live/documents/document.md')
      .reply(500); // contentBusCopy fails — publishStatus not reached

    const job = await createJob(ctx, info, ['/documents/document']);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    const resource = job.state.data.resources[0];
    assert.ok(resource.status && resource.status !== 200, 'resource should have an error status');
    assert.strictEqual(job.state.progress.failed, 1);
    // failed resources are still purged/indexed (status !== 304), triggering a notification
    assert.strictEqual(notified, 1);
  });

  it('excludes /.helix/ and /.snapshots/ paths during prepare', async () => {
    // no S3 calls — both paths are excluded in prepare, no resources to publish
    const job = await createJob(ctx, info, [
      '/.helix/config.json',
      '/.snapshots/abc/document',
    ]);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(job.state.data.resources.length, 0);
    assert.strictEqual(notified, 0);
  });

  it('uses purge-all when more than PURGE_ALL_CONTENT_THRESHOLD resources are published', async () => {
    const count = PURGE_ALL_CONTENT_THRESHOLD + 1;
    const paths = Array.from({ length: count }, (_, i) => `/doc${String(i).padStart(4, '0')}`);

    const content = nock.content();

    for (let i = 0; i < count; i += 1) {
      const key = `/doc${String(i).padStart(4, '0')}`;
      content
        .headObject(`/preview${key}.md`)
        .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW })
        .headObject(`/live${key}.md`)
        .reply(404)
        .headObject(`/preview${key}.md`)
        .reply(200)
        .copyObject(`/live${key}.md`)
        .reply(200, COPY_XML)
        .headObject(`/live${key}.md`)
        .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW, 'content-type': 'text/markdown' });
    }

    const job = await createJob(ctx, info, paths);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    // purge-all: single entry for the entire content bus ID
    assert.deepStrictEqual(purgeInfos, [{ key: CONTENT_BUS_ID }]);
    assert.strictEqual(notified, 1);
  });

  it('places metadata resource first and calls purge.config after publish', async () => {
    nock.content()
      .headObject(`/preview${METADATA_JSON_PATH}`)
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW })
      .headObject(`/live${METADATA_JSON_PATH}`)
      .reply(404)
      .headObject(`/preview${METADATA_JSON_PATH}`)
      .reply(200)
      .copyObject(`/live${METADATA_JSON_PATH}`)
      .reply(200, COPY_XML)
      .headObject(`/live${METADATA_JSON_PATH}`)
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW, 'content-type': 'application/json' });

    const job = await createJob(ctx, info, [METADATA_JSON_PATH]);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.ok(job.state.data.resources[0].metadata, 'metadata resource should be flagged');
    assert.deepStrictEqual(purgeInfos, [
      { key: 'U_NW4adJU7Qazf-I' },
      { key: 'bu2SqxB_sPgGHVxe' },
    ]);
    assert.strictEqual(notified, 1);
  });

  it('processes redirects.json first and purges updated redirect paths', async () => {
    nock.content()
      .headObject(`/preview${REDIRECTS_JSON_PATH}`)
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW })
      .headObject(`/live${REDIRECTS_JSON_PATH}`)
      .reply(404) // isModified
      .headObject(`/preview${REDIRECTS_JSON_PATH}`)
      .reply(200) // storage.copy addMetadata
      .copyObject(`/live${REDIRECTS_JSON_PATH}`)
      .reply(200, COPY_XML)
      .headObject(`/live${REDIRECTS_JSON_PATH}`)
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW, 'content-type': 'application/json' })
      // updateRedirects calls ctx.getRedirects('live') — cache cleared in processRedirects
      .getObject(`/live${REDIRECTS_JSON_PATH}`)
      .reply(404); // no redirects on live

    const job = await createJob(ctx, info, [REDIRECTS_JSON_PATH]);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(notified, 1);
  });

  it('stops job when stop signal received during processing', async () => {
    nock.content()
      .headObject('/preview/documents/document.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW });

    // checkStopped=true prevents the index phase from running → no CDN purge, no notification

    const job = await createJob(ctx, info, ['/documents/document']);
    job.checkStopped = sinon.stub().resolves(true);
    await job.run();

    const resource = job.state.data.resources.find((r) => r.resourcePath === '/documents/document.md');
    assert.ok(!resource?.status, 'resource should have no publish status when stopped before processing');
    assert.strictEqual(purgeInfos.length, 0, 'no purge should happen when stopped');
    assert.strictEqual(notified, 0);
  });

  it('warns but continues when storage.head throws for one resource during prepare', async () => {
    const warnSpy = sandbox.spy(ctx.log, 'warn');

    nock.content()
      // doc1: HEAD throws (simulated by connection error)
      .headObject('/preview/documents/doc1.md')
      .replyWithError('connection reset')
      // doc2: HEAD succeeds
      .headObject('/preview/documents/doc2.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW })
      // doc1: no status, no lastModified (storage error) → isModified returns true immediately
      .headObject('/preview/documents/doc1.md')
      .reply(200)
      .copyObject('/live/documents/doc1.md')
      .reply(200, COPY_XML)
      .headObject('/live/documents/doc1.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW, 'content-type': 'text/markdown' })
      // doc2: isModified → modified → publish
      .headObject('/live/documents/doc2.md')
      .reply(404)
      .headObject('/preview/documents/doc2.md')
      .reply(200)
      .copyObject('/live/documents/doc2.md')
      .reply(200, COPY_XML)
      .headObject('/live/documents/doc2.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW, 'content-type': 'text/markdown' });

    const job = await createJob(ctx, info, ['/documents/doc1', '/documents/doc2']);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.ok(
      warnSpy.calledWithMatch('unable to get lastModified for /documents/doc1.md'),
      'should warn about the storage error',
    );
    // doc1 has no lastModified (storage error), so it's treated as modified and published
    const doc1 = job.state.data.resources.find((r) => r.resourcePath === '/documents/doc1.md');
    assert.strictEqual(doc1.status, 200, 'doc1 should still be published after storage error in prepare');
    const doc2 = job.state.data.resources.find((r) => r.resourcePath === '/documents/doc2.md');
    assert.strictEqual(doc2.status, 200, 'doc2 should be published normally');
    assert.strictEqual(notified, 1);
  });

  it('warns and treats resource as modified when isModified storage.head throws', async () => {
    const warnSpy = sandbox.spy(ctx.log, 'warn');

    nock.content()
      // prepare: HEAD succeeds → resource.lastModified is set
      .headObject('/preview/documents/document.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW })
      // isModified: HEAD throws → catch block → treated as modified
      .headObject('/live/documents/document.md')
      .replyWithError('connection reset')
      // liveUpdate proceeds
      .headObject('/preview/documents/document.md')
      .reply(200)
      .copyObject('/live/documents/document.md')
      .reply(200, COPY_XML)
      .headObject('/live/documents/document.md')
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW, 'content-type': 'text/markdown' });

    const job = await createJob(ctx, info, ['/documents/document']);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.strictEqual(job.state.data.resources[0].status, 200);
    assert.ok(
      warnSpy.calledWithMatch('unable to get lastModified for /documents/document.md'),
      'should warn about the isModified storage error',
    );
    assert.strictEqual(notified, 1);
  });

  it('rejects resumes from prepare phase', async () => {
    const job = await createJob(ctx, info, ['/documents/document']);
    job.state.data.phase = 'prepare';
    job.state.data.resources = [{ path: '/documents/document', resourcePath: '/documents/document.md' }];
    await assert.rejects(job.run(), Error('job cannot be resumed during the prepare phase. please provide a smaller input set.'));
  });

  it('sets needsBulkIndex when metadata is published and simple sitemap exists', async () => {
    const configStub = sandbox.stub(purge, 'config').resolves();
    // override the beforeEach default so hasSimpleSitemap returns true,
    // causing the needsBulkIndex branch (lines 309-310, 358-360) to be hit
    ctx.attributes.hasSimpleSitemap = true;

    nock.content()
      .headObject(`/preview${METADATA_JSON_PATH}`)
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW })
      .headObject(`/live${METADATA_JSON_PATH}`)
      .reply(404)
      .headObject(`/preview${METADATA_JSON_PATH}`)
      .reply(200)
      .copyObject(`/live${METADATA_JSON_PATH}`)
      .reply(200, COPY_XML)
      .headObject(`/live${METADATA_JSON_PATH}`)
      .reply(200, '', { 'last-modified': LAST_MODIFIED_PREVIEW, 'content-type': 'application/json' });

    const job = await createJob(ctx, info, [METADATA_JSON_PATH]);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    // needsBulkIndex was set then deleted — confirm it's gone and job completed normally
    assert.strictEqual(job.state.data.needsBulkIndex, undefined);
    assert.ok(configStub.calledOnce, 'purge.config should be called after metadata publish');
    assert.strictEqual(notified, 1);
  });
});
