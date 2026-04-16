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

import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { SnapshotJob } from '../../src/snapshot/SnapshotJob.js';
import { SnapshotRemoveJob } from '../../src/snapshot/SnapshotRemoveJob.js';
import { SnapshotBaseJob } from '../../src/snapshot/SnapshotBaseJob.js';
import { SnapshotResource } from '../../src/snapshot/SnapshotResource.js';
import { Manifest } from '../../src/snapshot/Manifest.js';
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

const COPY_XML = new xml2js.Builder().buildObject({
  CopyObjectResult: {
    ETag: '"abc123"',
    LastModified: '2023-10-06T08:05:00.000Z',
  },
});

const LAST_MODIFIED_OLD = 'Thu, 01 Jan 2023 00:00:00 GMT';
const LAST_MODIFIED_NEW = 'Fri, 02 Jan 2024 00:00:00 GMT';
const LAST_MODIFIED_OLD_ISO = '2023-01-01T00:00:00.000Z';

const MANIFEST_DATA = {
  id: 'test-snap',
  created: '2025-01-01T00:00:00.000Z',
  lastModified: '2025-01-01T00:00:00.000Z',
  resources: [
    { path: '/documents/doc1', status: 200 },
    { path: '/images/hero.png', status: 200 },
  ],
};

/** Job sandboxes to restore after each test. */
const jobSandboxes = [];

/**
 * Creates a job instance with stubbed lifecycle methods for isolated testing.
 */
async function createTestJob(ctx, info, JobClass, data = {}) {
  const topic = JobClass === SnapshotRemoveJob ? SnapshotRemoveJob.TOPIC : 'snapshot';
  const storage = await JobStorage.create(ctx, info, JobClass);
  const job = new JobClass(ctx, info, topic, 'test-job', storage, true);
  job.transient = true;
  job.state = {
    topic,
    name: 'test-job',
    state: 'running',
    data: { snapshotId: 'test-snap', ...data },
    progress: { total: 0, processed: 0, failed: 0 },
  };

  const sb = sinon.createSandbox();
  sb.stub(job, 'writeState').resolves();
  sb.stub(job, 'writeStateLazy').resolves();
  sb.stub(job, 'setPhase').callsFake(async (phase) => {
    job.state.data.phase = phase;
  });
  sb.stub(job, 'trackProgress').callsFake(async (stat) => {
    Object.assign(job.state.progress, stat);
  });
  sb.stub(job, 'checkStopped').resolves(false);
  jobSandboxes.push(sb);
  return job;
}

describe('SnapshotBaseJob Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {sinon.SinonSandbox} */
  let sandbox;

  let ctx;
  let info;

  beforeEach(() => {
    nock = new Nock().env({ HELIX_STORAGE_DISABLE_R2: 'true' });
    sandbox = sinon.createSandbox();

    sandbox.stub(purge, 'content').resolves();

    ctx = createContext('/org/sites/site/snapshots/test-snap/*', {
      env: { HELIX_STORAGE_DISABLE_R2: 'true' },
      attributes: {
        authInfo: AuthInfo.Admin(),
        config: structuredClone(SITE_CONFIG),
        infoMarkerChecked: true,
      },
    });
    info = createInfo('/org/sites/site/snapshots/test-snap/*');
  });

  afterEach(() => {
    jobSandboxes.splice(0).forEach((sb) => sb.restore());
    sandbox.restore();
    nock.done();
  });

  describe('abstract method guards', () => {
    it('notificationOp throws on base class', () => {
      assert.throws(
        () => SnapshotBaseJob.prototype.notificationOp,
        /subclass must override notificationOp/,
      );
    });

    it('getSourceRoot throws on base class', () => {
      assert.throws(
        () => SnapshotBaseJob.prototype.getSourceRoot({}),
        /subclass must override getSourceRoot/,
      );
    });

    it('processResource throws on base class', async () => {
      await assert.rejects(
        SnapshotBaseJob.prototype.processResource({}, {}, {}),
        /subclass must override processResource/,
      );
    });

    it('isSuccess returns true for 2xx on base class', () => {
      assert.strictEqual(SnapshotBaseJob.prototype.isSuccess(200), true);
      assert.strictEqual(SnapshotBaseJob.prototype.isSuccess(204), true);
      assert.strictEqual(SnapshotBaseJob.prototype.isSuccess(500), false);
      assert.strictEqual(SnapshotBaseJob.prototype.isSuccess(404), false);
    });
  });

  describe('prepare()', () => {
    it('resolves prefix entries via bucket.list', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      const root = `${CONTENT_BUS_ID}/preview`;

      nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/preview/documents/`, [
        { Key: 'doc1.md', LastModified: LAST_MODIFIED_OLD_ISO },
        { Key: 'doc2.md', LastModified: LAST_MODIFIED_OLD_ISO },
      ], '');

      const paths = [{ prefix: '/documents/' }];
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      const resources = await job.prepare(paths, root, bucket);

      assert.strictEqual(resources.length, 2);
      assert.strictEqual(resources[0].resourcePath, '/documents/doc1.md');
      assert.strictEqual(resources[0].webPath, '/documents/doc1');
      assert.strictEqual(resources[1].resourcePath, '/documents/doc2.md');
      assert.strictEqual(resources[1].webPath, '/documents/doc2');
    });

    it('filters out directory entries from prefix listing', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      const root = `${CONTENT_BUS_ID}/preview`;

      nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/preview/documents/`, [
        { Key: 'doc1.md', LastModified: LAST_MODIFIED_OLD_ISO },
        { Key: 'subfolder/' },
      ], '');

      const paths = [{ prefix: '/documents/' }];
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      const resources = await job.prepare(paths, root, bucket);

      assert.strictEqual(resources.length, 1);
      assert.strictEqual(resources[0].resourcePath, '/documents/doc1.md');
    });

    it('resolves single path entries via bucket.head (found)', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      const root = `${CONTENT_BUS_ID}/preview`;

      nock.content()
        .headObject('/preview/documents/doc1.md')
        .reply(200, '', { 'last-modified': LAST_MODIFIED_OLD });

      const paths = [{ path: '/documents/doc1' }];
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      const resources = await job.prepare(paths, root, bucket);

      assert.strictEqual(resources.length, 1);
      assert.strictEqual(resources[0].resourcePath, '/documents/doc1.md');
      assert.strictEqual(resources[0].webPath, '/documents/doc1');
      assert.ok(resources[0].lastModified instanceof Date);
      assert.strictEqual(resources[0].status, undefined);
    });

    it('resolves single path entries via bucket.head (not found)', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      const root = `${CONTENT_BUS_ID}/preview`;

      nock.content()
        .headObject('/preview/documents/missing.md')
        .reply(404);

      const paths = [{ path: '/documents/missing' }];
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      const resources = await job.prepare(paths, root, bucket);

      assert.strictEqual(resources.length, 1);
      assert.strictEqual(resources[0].resourcePath, '/documents/missing.md');
      assert.strictEqual(resources[0].status, 404);
    });

    it('excludes .helix/ and .snapshots/ paths from prefix listing', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      const root = `${CONTENT_BUS_ID}/preview`;

      nock.listObjects('helix-content-bus', `${CONTENT_BUS_ID}/preview/`, [
        { Key: '.helix/config.json', LastModified: LAST_MODIFIED_OLD_ISO },
        { Key: '.snapshots/abc/doc.md', LastModified: LAST_MODIFIED_OLD_ISO },
        { Key: 'documents/doc1.md', LastModified: LAST_MODIFIED_OLD_ISO },
      ], '');

      const paths = [{ prefix: '/' }];
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      const resources = await job.prepare(paths, root, bucket);

      assert.strictEqual(resources.length, 1);
      assert.strictEqual(resources[0].resourcePath, '/documents/doc1.md');
    });

    it('excludes .helix/ and .snapshots/ single paths', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      const root = `${CONTENT_BUS_ID}/preview`;

      const paths = [
        { path: '/.helix/config.json' },
        { path: '/.snapshots/abc/document' },
      ];
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      const resources = await job.prepare(paths, root, bucket);

      assert.strictEqual(resources.length, 0);
    });
  });

  describe('executeBatch()', () => {
    it('processes resources, purges cache, and sends notifications', async () => {
      let notified = 0;
      nock('https://sns.us-east-1.amazonaws.com:443')
        .post('/')
        .reply(() => {
          notified += 1;
          return [200, SNS_RESPONSE_BODY];
        });

      const job = await createTestJob(ctx, info, SnapshotJob, {
        snapshotId: 'test-snap',
      });

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      job.state.data.resources = [resource];

      const manifest = new Manifest();
      manifest.id = 'test-snap';
      manifest.addResource('/documents/doc1', Manifest.STATUS_EXISTS);

      // Stub processResource to simulate success — update the resource in manifest
      // so that addResource sees the resource already exists and marks it for purge
      sandbox.stub(job, 'processResource').callsFake(async (r) => {
        r.setStatus(200);
        manifest.addResource(r.webPath, Manifest.STATUS_EXISTS);
        manifest.markResourceUpdated();
      });

      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      await job.executeBatch(manifest, bucket);

      assert.strictEqual(resource.status, 200);
      assert.strictEqual(notified, 1);
      assert.ok(purge.content.called);
    });

    it('stops processing when checkStopped returns true', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, {
        snapshotId: 'test-snap',
      });
      job.checkStopped.resolves(true);

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      job.state.data.resources = [resource];

      const manifest = new Manifest();
      manifest.id = 'test-snap';

      sandbox.stub(job, 'processResource').callsFake(async (r) => {
        r.setStatus(200);
      });

      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      await job.executeBatch(manifest, bucket);

      assert.strictEqual(job.processResource.callCount, 0);
    });
  });

  describe('run()', () => {
    it('goes through prepare -> perform -> completed phases', async () => {
      nock.content()
        // manifest GET
        .getObject('/preview/.snapshots/test-snap/.manifest.json')
        .reply(200, JSON.stringify(MANIFEST_DATA))
        // prepare: HEAD for single path resource
        .headObject('/preview/documents/doc1.md')
        .reply(200, '', { 'last-modified': LAST_MODIFIED_OLD })
        // isModified: HEAD snapshot copy — not found, so modified
        .headObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(404)
        // updateSnapshot: HEAD source exists check
        .headObject('/preview/documents/doc1.md')
        .reply(200)
        // updateSnapshot: storage.copy addMetadata HEAD
        .headObject('/preview/documents/doc1.md')
        .reply(200)
        // updateSnapshot: storage.copy CopyObject
        .copyObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(200, COPY_XML)
        // store manifest
        .putObject('/preview/.snapshots/test-snap/.manifest.json')
        .reply(200);

      nock('https://sns.us-east-1.amazonaws.com:443')
        .post('/')
        .reply(200, SNS_RESPONSE_BODY);

      const job = await createTestJob(ctx, info, SnapshotJob, {
        paths: [{ path: '/documents/doc1' }],
        snapshotId: 'test-snap',
      });

      await job.run();

      assert.strictEqual(job.state.data.phase, 'completed');
      assert.strictEqual(job.state.data.resources.length, 1);
      assert.strictEqual(job.state.data.resources[0].status, 200);
      assert.strictEqual(job.state.progress.total, 1);
    });

    it('resumes from perform phase with existing resources', async () => {
      nock.content()
        // manifest GET
        .getObject('/preview/.snapshots/test-snap/.manifest.json')
        .reply(200, JSON.stringify(MANIFEST_DATA))
        // isModified: HEAD snapshot copy — not found, so modified
        .headObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(404)
        // updateSnapshot: HEAD source exists check
        .headObject('/preview/documents/doc1.md')
        .reply(200)
        // updateSnapshot: storage.copy addMetadata HEAD
        .headObject('/preview/documents/doc1.md')
        .reply(200)
        // updateSnapshot: storage.copy CopyObject
        .copyObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(200, COPY_XML)
        // store manifest
        .putObject('/preview/.snapshots/test-snap/.manifest.json')
        .reply(200);

      nock('https://sns.us-east-1.amazonaws.com:443')
        .post('/')
        .reply(200, SNS_RESPONSE_BODY);

      const job = await createTestJob(ctx, info, SnapshotJob, {
        paths: [{ path: '/documents/doc1' }],
        snapshotId: 'test-snap',
        phase: 'perform',
        resources: [{
          resourcePath: '/documents/doc1.md',
          webPath: '/documents/doc1',
          lastModified: LAST_MODIFIED_OLD,
        }],
      });

      await job.run();

      assert.strictEqual(job.state.data.phase, 'completed');
      assert.ok(job.state.data.resources[0] instanceof SnapshotResource);
    });

    it('stores manifest in finally block even when executeBatch throws', async () => {
      nock.content()
        // manifest GET
        .getObject('/preview/.snapshots/test-snap/.manifest.json')
        .reply(200, JSON.stringify(MANIFEST_DATA))
        // prepare: HEAD
        .headObject('/preview/documents/doc1.md')
        .reply(200, '', { 'last-modified': LAST_MODIFIED_OLD });

      const job = await createTestJob(ctx, info, SnapshotJob, {
        paths: [{ path: '/documents/doc1' }],
        snapshotId: 'test-snap',
      });

      sandbox.stub(job, 'executeBatch').rejects(new Error('batch failed'));

      await assert.rejects(job.run(), /batch failed/);
    });
  });
});

describe('SnapshotJob Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {sinon.SinonSandbox} */
  let sandbox;

  let ctx;
  let info;

  beforeEach(() => {
    nock = new Nock().env({ HELIX_STORAGE_DISABLE_R2: 'true' });
    sandbox = sinon.createSandbox();

    sandbox.stub(purge, 'content').resolves();

    ctx = createContext('/org/sites/site/snapshots/test-snap/*', {
      env: { HELIX_STORAGE_DISABLE_R2: 'true' },
      attributes: {
        authInfo: AuthInfo.Admin(),
        config: structuredClone(SITE_CONFIG),
        infoMarkerChecked: true,
      },
    });
    info = createInfo('/org/sites/site/snapshots/test-snap/*');
  });

  afterEach(() => {
    jobSandboxes.splice(0).forEach((sb) => sb.restore());
    sandbox.restore();
    nock.done();
  });

  describe('notificationOp', () => {
    it('returns resources-snapshot', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      assert.strictEqual(job.notificationOp, 'resources-snapshot');
    });
  });

  describe('getSourceRoot()', () => {
    it('returns preview partition by default', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      const manifest = { fromLive: false };
      assert.strictEqual(
        job.getSourceRoot(CONTENT_BUS_ID, manifest),
        `${CONTENT_BUS_ID}/preview`,
      );
    });

    it('returns live partition when fromLive=true', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      const manifest = { fromLive: true };
      assert.strictEqual(
        job.getSourceRoot(manifest),
        `${CONTENT_BUS_ID}/live`,
      );
    });
  });

  describe('isSuccess()', () => {
    it('returns true for 200', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      assert.strictEqual(job.isSuccess(200), true);
    });

    it('returns true for 404 (marked for deletion)', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      assert.strictEqual(job.isSuccess(Manifest.STATUS_DELETED), true);
    });

    it('returns false for 500', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      assert.strictEqual(job.isSuccess(500), false);
    });

    it('returns false for 304', async () => {
      const job = await createTestJob(ctx, info, SnapshotJob, { paths: [] });
      assert.strictEqual(job.isSuccess(304), false);
    });
  });

  describe('isModified()', () => {
    it('returns true when snapshot copy does not exist', async () => {
      nock.content()
        .headObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(404);

      const job = await createTestJob(ctx, info, SnapshotJob, { snapshotId: 'test-snap' });
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      resource.setLastModified(LAST_MODIFIED_OLD);

      const result = await job.isModified(bucket, resource);
      assert.strictEqual(result, true);
    });

    it('returns true when snapshot copy is older than source', async () => {
      nock.content()
        .headObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(200, '', { 'last-modified': LAST_MODIFIED_OLD });

      const job = await createTestJob(ctx, info, SnapshotJob, { snapshotId: 'test-snap' });
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      resource.setLastModified(LAST_MODIFIED_NEW);

      const result = await job.isModified(bucket, resource);
      assert.strictEqual(result, true);
    });

    it('returns false when snapshot copy is newer than source', async () => {
      nock.content()
        .headObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(200, '', { 'last-modified': LAST_MODIFIED_NEW });

      const job = await createTestJob(ctx, info, SnapshotJob, { snapshotId: 'test-snap' });
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      resource.setLastModified(LAST_MODIFIED_OLD);

      const result = await job.isModified(bucket, resource);
      assert.strictEqual(result, false);
    });
  });

  describe('processResource()', () => {
    it('skips unmodified resources (304)', async () => {
      nock.content()
        .headObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(200, '', { 'last-modified': LAST_MODIFIED_NEW });

      const job = await createTestJob(ctx, info, SnapshotJob, {
        snapshotId: 'test-snap',
        forceUpdate: false,
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';
      manifest.addResource('/documents/doc1', Manifest.STATUS_EXISTS);

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      resource.setLastModified(LAST_MODIFIED_OLD);

      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      await job.processResource(resource, manifest, bucket);

      assert.strictEqual(resource.status, 304);
      assert.strictEqual(job.state.progress.processed, 1);
    });

    it('copies resource via updateSnapshot when modified', async () => {
      nock.content()
        // isModified check
        .headObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(404)
        // updateSnapshot: HEAD source exists check
        .headObject('/preview/documents/doc1.md')
        .reply(200)
        // updateSnapshot: storage.copy addMetadata HEAD
        .headObject('/preview/documents/doc1.md')
        .reply(200)
        // updateSnapshot: storage.copy CopyObject
        .copyObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(200, COPY_XML);

      const job = await createTestJob(ctx, info, SnapshotJob, {
        snapshotId: 'test-snap',
        forceUpdate: false,
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';
      manifest.addResource('/documents/doc1', Manifest.STATUS_EXISTS);
      ctx.attributes.snapshotManifest = manifest;

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      resource.setLastModified(LAST_MODIFIED_OLD);

      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      await job.processResource(resource, manifest, bucket);

      assert.strictEqual(resource.status, 200);
      assert.strictEqual(job.state.progress.processed, 1);
    });

    it('records 404 when source resource does not exist', async () => {
      nock.content()
        // updateSnapshot: HEAD source — not found
        .headObject('/preview/documents/missing.md')
        .reply(404);

      const job = await createTestJob(ctx, info, SnapshotJob, {
        snapshotId: 'test-snap',
        forceUpdate: false,
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';
      ctx.attributes.snapshotManifest = manifest;

      const resource = new SnapshotResource('/documents/missing.md', '/documents/missing');
      resource.setStatus(404); // from prepare phase

      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      await job.processResource(resource, manifest, bucket);

      // 404 from prepare, updateSnapshot returns 204 (source missing), effective status stays 404
      assert.strictEqual(resource.status, 404);
      assert.strictEqual(job.state.progress.processed, 1);
    });

    it('skips isModified check with forceUpdate=true', async () => {
      nock.content()
        // updateSnapshot: HEAD source exists check
        .headObject('/preview/documents/doc1.md')
        .reply(200)
        // updateSnapshot: storage.copy addMetadata HEAD
        .headObject('/preview/documents/doc1.md')
        .reply(200)
        // updateSnapshot: storage.copy CopyObject
        .copyObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(200, COPY_XML);

      const job = await createTestJob(ctx, info, SnapshotJob, {
        snapshotId: 'test-snap',
        forceUpdate: true,
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';
      manifest.addResource('/documents/doc1', Manifest.STATUS_EXISTS);
      ctx.attributes.snapshotManifest = manifest;

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      resource.setLastModified(LAST_MODIFIED_OLD);

      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      await job.processResource(resource, manifest, bucket);

      assert.strictEqual(resource.status, 200);
    });

    it('records error when updateSnapshot fails', async () => {
      nock.content()
        // isModified check
        .headObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(404)
        // updateSnapshot: HEAD source exists check
        .headObject('/preview/documents/doc1.md')
        .reply(200)
        // updateSnapshot: storage.copy addMetadata HEAD
        .headObject('/preview/documents/doc1.md')
        .reply(200)
        // updateSnapshot: storage.copy CopyObject fails
        .copyObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(500);

      const job = await createTestJob(ctx, info, SnapshotJob, {
        snapshotId: 'test-snap',
        forceUpdate: false,
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';
      manifest.addResource('/documents/doc1', Manifest.STATUS_EXISTS);
      ctx.attributes.snapshotManifest = manifest;

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      resource.setLastModified(LAST_MODIFIED_OLD);

      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();
      await job.processResource(resource, manifest, bucket);

      assert.ok(resource.status >= 400, 'resource should have error status');
      assert.strictEqual(job.state.progress.failed, 1);
    });
  });
});

describe('SnapshotRemoveJob Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {sinon.SinonSandbox} */
  let sandbox;

  let ctx;
  let info;

  beforeEach(() => {
    nock = new Nock().env({ HELIX_STORAGE_DISABLE_R2: 'true' });
    sandbox = sinon.createSandbox();

    sandbox.stub(purge, 'content').resolves();

    ctx = createContext('/org/sites/site/snapshots/test-snap/*', {
      env: { HELIX_STORAGE_DISABLE_R2: 'true' },
      attributes: {
        authInfo: AuthInfo.Admin(),
        config: structuredClone(SITE_CONFIG),
        infoMarkerChecked: true,
      },
    });
    info = createInfo('/org/sites/site/snapshots/test-snap/*');
  });

  afterEach(() => {
    jobSandboxes.splice(0).forEach((sb) => sb.restore());
    sandbox.restore();
    nock.done();
  });

  describe('notificationOp', () => {
    it('returns resources-snapshot-removed', async () => {
      const job = await createTestJob(ctx, info, SnapshotRemoveJob, { paths: [] });
      assert.strictEqual(job.notificationOp, 'resources-snapshot-removed');
    });
  });

  describe('TOPIC', () => {
    it('is snapshot-remove', () => {
      assert.strictEqual(SnapshotRemoveJob.TOPIC, 'snapshot-remove');
    });
  });

  describe('getSourceRoot()', () => {
    it('returns snapshot partition', async () => {
      const job = await createTestJob(ctx, info, SnapshotRemoveJob, { paths: [] });
      const manifest = { id: 'test-snap' };
      assert.strictEqual(
        job.getSourceRoot(manifest),
        `${CONTENT_BUS_ID}/preview/.snapshots/test-snap`,
      );
    });
  });

  describe('remove()', () => {
    it('deletes resource from storage and updates manifest', async () => {
      nock.content()
        .deleteObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(204);

      const job = await createTestJob(ctx, info, SnapshotRemoveJob, {
        snapshotId: 'test-snap',
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';
      manifest.addResource('/documents/doc1', Manifest.STATUS_EXISTS);

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();

      const result = await job.remove(resource, manifest, bucket, CONTENT_BUS_ID);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.status, 204);
      assert.strictEqual(manifest.getResourceStatus('/documents/doc1'), 0);
    });
  });

  describe('processResource()', () => {
    it('deletes resource from snapshot storage', async () => {
      nock.content()
        .deleteObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(204);

      const job = await createTestJob(ctx, info, SnapshotRemoveJob, {
        snapshotId: 'test-snap',
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';
      manifest.addResource('/documents/doc1', Manifest.STATUS_EXISTS);

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();

      await job.processResource(resource, manifest, bucket);

      assert.strictEqual(resource.status, 204);
      assert.strictEqual(job.state.progress.processed, 1);
      assert.strictEqual(job.state.progress.failed, 0);
    });

    it('skips already-processed resources', async () => {
      const job = await createTestJob(ctx, info, SnapshotRemoveJob, {
        snapshotId: 'test-snap',
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      resource.setStatus(204);

      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();

      await job.processResource(resource, manifest, bucket);

      assert.strictEqual(resource.status, 204);
      assert.strictEqual(job.state.progress.processed, 1);
    });

    it('handles 404 resource still in manifest (removes from manifest, increments failed)', async () => {
      const job = await createTestJob(ctx, info, SnapshotRemoveJob, {
        snapshotId: 'test-snap',
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';
      manifest.addResource('/documents/doc1', Manifest.STATUS_EXISTS);

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      resource.setStatus(404);

      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();

      await job.processResource(resource, manifest, bucket);

      assert.strictEqual(resource.status, 404);
      assert.strictEqual(job.state.progress.processed, 1);
      assert.strictEqual(job.state.progress.failed, 1);
      assert.strictEqual(manifest.getResourceStatus('/documents/doc1'), 0);
    });

    it('handles 404 resource not in manifest (no-op)', async () => {
      const job = await createTestJob(ctx, info, SnapshotRemoveJob, {
        snapshotId: 'test-snap',
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      resource.setStatus(404);

      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();

      await job.processResource(resource, manifest, bucket);

      assert.strictEqual(resource.status, 404);
      assert.strictEqual(job.state.progress.processed, 1);
      assert.strictEqual(job.state.progress.failed, 0);
    });

    it('logs warning for orphaned resource not in manifest', async () => {
      const warnSpy = sandbox.spy(ctx.log, 'warn');

      nock.content()
        .deleteObject('/preview/.snapshots/test-snap/documents/orphan.md')
        .reply(204);

      const job = await createTestJob(ctx, info, SnapshotRemoveJob, {
        snapshotId: 'test-snap',
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';

      const resource = new SnapshotResource('/documents/orphan.md', '/documents/orphan');
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();

      await job.processResource(resource, manifest, bucket);

      assert.strictEqual(resource.status, 204);
      assert.ok(
        warnSpy.calledWithMatch('removing orphaned resource /documents/orphan from snapshot test-snap'),
        'should warn about orphaned resource',
      );
    });

    it('records error and increments failed when remove fails', async () => {
      nock.content()
        .deleteObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .replyWithError('connection reset');

      const job = await createTestJob(ctx, info, SnapshotRemoveJob, {
        snapshotId: 'test-snap',
      });

      const manifest = new Manifest();
      manifest.id = 'test-snap';
      manifest.addResource('/documents/doc1', Manifest.STATUS_EXISTS);

      const resource = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      const { HelixStorage } = await import('@adobe/helix-shared-storage');
      const bucket = HelixStorage.fromContext(ctx).contentBus();

      await job.processResource(resource, manifest, bucket);

      assert.ok(resource.status >= 400, 'resource should have error status');
      assert.strictEqual(job.state.progress.failed, 1);
    });
  });

  describe('run() end-to-end', () => {
    it('removes resources through full job lifecycle', async () => {
      nock.content()
        // manifest GET
        .getObject('/preview/.snapshots/test-snap/.manifest.json')
        .reply(200, JSON.stringify(MANIFEST_DATA))
        // prepare: HEAD for resource in snapshot partition
        .headObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(200, '', { 'last-modified': LAST_MODIFIED_OLD })
        // remove: delete resource
        .deleteObject('/preview/.snapshots/test-snap/documents/doc1.md')
        .reply(204)
        // store manifest
        .putObject('/preview/.snapshots/test-snap/.manifest.json')
        .reply(200);

      nock('https://sns.us-east-1.amazonaws.com:443')
        .post('/')
        .reply(200, SNS_RESPONSE_BODY);

      const job = await createTestJob(ctx, info, SnapshotRemoveJob, {
        paths: [{ path: '/documents/doc1' }],
        snapshotId: 'test-snap',
      });

      await job.run();

      assert.strictEqual(job.state.data.phase, 'completed');
      assert.strictEqual(job.state.data.resources.length, 1);
      assert.strictEqual(job.state.data.resources[0].status, 204);
    });
  });
});
