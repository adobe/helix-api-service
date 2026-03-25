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
import { Response } from '@adobe/fetch';
import sinon from 'sinon';

import { AuthInfo } from '../../src/auth/auth-info.js';
import { HANDLERS } from '../../src/contentproxy/index.js';
import { JobStorage } from '../../src/job/storage.js';
import { PURGE_ALL_CONTENT_THRESHOLD } from '../../src/contentbus/contentbus.js';
import { PreviewJob } from '../../src/preview/preview-job.js';
import purge from '../../src/cache/purge.js';
import { createContext, createInfo, Nock } from '../utils.js';

const CONTENT_BUS_ID = 'foo-id';

const TEST_SOURCE = { type: 'test-pj', url: 'test://foo-bar' };

const TEST_CONFIG = {
  content: {
    contentBusId: CONTENT_BUS_ID,
    source: TEST_SOURCE,
  },
  code: {
    owner: 'owner',
    repo: 'repo',
    source: { type: 'github', url: 'https://github.com/owner/repo' },
  },
};

const SNS_RESPONSE_BODY = new xml2js.Builder().buildObject({
  PublishResponse: {
    PublishResult: {
      SequenceNumber: '1',
      MessageId: '1',
    },
  },
});

const DEFAULT_FILE_LIST = [{
  path: '/foo/new',
  resourcePath: '/foo/new.md',
  source: {
    contentType: 'application/octet-stream',
    lastModified: 1000,
    location: 'test-location',
    size: 123,
  },
}, {
  path: '/foo/old',
  resourcePath: '/foo/old.md',
  source: {
    contentType: 'application/octet-stream',
    lastModified: 0,
    location: 'test-location',
    size: 123,
  },
}, {
  path: '/foo/modified',
  resourcePath: '/foo/modified.md',
  source: {
    contentType: 'application/octet-stream',
    lastModified: 2000,
    location: 'test-location',
    size: 123,
  },
}, {
  path: '/foo/missing',
  status: 404,
}];

const createTestHandler = (fileList = DEFAULT_FILE_LIST) => ({
  get name() { return 'test-pj'; },
  async handle() { return new Response('ok'); },
  async handleJSON() { return new Response('{"data":[]}'); },
  async list(ctx, info, paths, cb) {
    const cont = await cb({ total: fileList.length });
    if (!cont) return [];
    return fileList;
  },
});

/**
 * Creates a PreviewJob instance with stubs applied for isolated testing.
 * - writeState / writeStateLazy / setPhase / trackProgress / checkStopped / audit are all stubbed
 * - purge.perform / purge.config / purge.redirects are stubbed via sinon sandbox
 */
export const createJob = async (context, info, paths = ['/foo/new', '/foo/old', '/foo/modified', '/foo/missing']) => {
  const storage = await JobStorage.create(context, info, PreviewJob);
  const job = new PreviewJob(context, info, 'preview', 'job-123', storage);
  job.state = {
    data: {
      forceUpdate: false,
      paths,
    },
    progress: {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      notmodified: 0,
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

describe('PreviewJob Tests', () => {
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
    HANDLERS['test-pj'] = createTestHandler();

    ctx = createContext('/org/sites/site/preview/*', {
      env: { HELIX_STORAGE_DISABLE_R2: 'true' },
      attributes: {
        authInfo: AuthInfo.Admin(),
        config: structuredClone(TEST_CONFIG),
        infoMarkerChecked: true,
        redirects: { preview: {} },
      },
    });
    info = createInfo('/org/sites/site/preview/*');
    purgeInfos = [];
    sandbox.stub(purge, 'perform').callsFake((c, i, infos) => {
      purgeInfos.push(...infos);
    });
  });

  afterEach(() => {
    delete HANDLERS['test-pj'];
    sandbox.restore();
    nock.done();
  });

  it('rejects resume during collect phase', async () => {
    const job = await createJob(ctx, info);
    job.state.data.phase = 'collect';
    await assert.rejects(
      () => job.run(),
      { message: 'job cannot be resumed during the collect phase. please provide a smaller input set.' },
    );
  });

  it('collects resources from content source', async () => {
    const job = await createJob(ctx, info);
    await job.collect(['/foo/new', '/foo/old', '/foo/modified', '/foo/missing']);

    assert.strictEqual(job.state.data.resources.length, 4);
    assert.strictEqual(job.state.data.resources[0].path, '/foo/new');
    // missing file should have status 404
    const missing = job.state.data.resources.find((r) => r.path === '/foo/missing');
    assert.strictEqual(missing.status, 404);
  });

  it('prioritizes redirects.json first in resource list', async () => {
    const fileListWithRedirects = [...DEFAULT_FILE_LIST, {
      path: '/redirects.json',
      resourcePath: '/redirects.json',
      source: {
        contentType: 'application/json',
        lastModified: 0,
        location: 'test',
        size: 10,
      },
    }];
    HANDLERS['test-pj'].list = async (c, i, paths, cb) => {
      await cb({ total: fileListWithRedirects.length });
      return fileListWithRedirects;
    };

    const job = await createJob(ctx, info, ['/foo/new', '/redirects.json']);
    await job.collect(['/foo/new', '/redirects.json']);

    assert.strictEqual(job.state.data.resources[0].resourcePath, '/redirects.json');
    assert.ok(job.state.data.resources[0].redirects);
  });

  it('stops early during collect when checkStopped returns true', async () => {
    const job = await createJob(ctx, info);
    job.checkStopped = sinon.stub().resolves(true);

    await job.collect(['/foo/new']);
    assert.strictEqual(job.state.data.resources.length, 0);
  });

  it('getRateLimit returns DOCBASED for non-markup sources', async () => {
    const job = await createJob(ctx, info);
    job.state.data.resources = [{ source: { type: 'onedrive' } }];
    const rateLimit = job.getRateLimit();
    assert.strictEqual(rateLimit.maxConcurrent, 4);
    assert.strictEqual(rateLimit.limit, 1000);
  });

  it('getRateLimit returns BYOM for markup-only sources', async () => {
    const job = await createJob(ctx, info);
    job.state.data.resources = [{ source: { type: 'markup' } }];
    const rateLimit = job.getRateLimit();
    assert.strictEqual(rateLimit.maxConcurrent, 100);
    assert.strictEqual(rateLimit.limit, 600);
  });

  it('run() collects, previews, purges, and notifies', async () => {
    // Head requests for isNotModified checks
    nock.content(CONTENT_BUS_ID)
      .headObject('/preview/foo/new.md').reply(404) // new → update
      .headObject('/preview/foo/old.md')
      .reply(200, '', { 'last-modified': 'Thu, 01 Jan 1970 00:00:00 GMT' }) // old, not modified
      .headObject('/preview/foo/modified.md')
      .reply(200, '', { 'last-modified': 'Thu, 01 Jan 1970 00:00:00 GMT' }); // old timestamp, force update triggers

    // Stub contentproxy handle to return ok responses for update (fresh Response each call)
    sandbox.stub(HANDLERS['test-pj'], 'handle').callsFake(() => Promise.resolve(new Response('# content')));

    // S3 store calls for update
    nock.content(CONTENT_BUS_ID)
      .headObject('/preview/foo/new.md').optionally().reply(404) // infoMarker check
      .putObject('/preview/foo/new.md')
      .reply(201)
      .headObject('/preview/foo/modified.md')
      .optionally()
      .reply(404)
      .putObject('/preview/foo/modified.md')
      .reply(201);

    // SNS notification
    nock('https://sns.us-east-1.amazonaws.com:443')
      .post('/')
      .reply((_, body) => {
        const params = new URLSearchParams(body);
        const msg = JSON.parse(params.get('Message'));
        assert.strictEqual(msg.op, 'resources-previewed');
        return [200, SNS_RESPONSE_BODY];
      });

    const job = await createJob(ctx, info);
    await job.run();

    assert.strictEqual(job.state.data.phase, 'completed');
    assert.deepStrictEqual(purgeInfos, [
      { key: 'p_Ho7PLekudFPmskD4' },
      { key: 'p_bDG6BvDACXvgEGBX' },
      { key: 'p_1STMRI8ti52RMAhD' },
      { key: 'p_F33f078hL3sq9AGu' },
    ]);
  });

  it('run() purges with contentBusId key when resources exceed threshold', async () => {
    const largeFileList = Array.from({ length: PURGE_ALL_CONTENT_THRESHOLD + 5 }, (_, i) => ({
      path: `/doc${i}`,
      resourcePath: `/doc${i}.md`,
      source: {
        contentType: 'application/octet-stream',
        lastModified: 2000,
        location: 'test-location',
        size: 1,
      },
    }));

    HANDLERS['test-pj'] = createTestHandler(largeFileList);
    sandbox.restore(); // restore to re-stub after handler replacement
    sandbox = sinon.createSandbox();
    purgeInfos = [];
    sandbox.stub(purge, 'perform').callsFake((c, i, infos) => {
      purgeInfos.push(...infos);
    });
    sandbox.stub(purge, 'config').resolves();
    sandbox.stub(purge, 'redirects').resolves();
    sandbox.stub(HANDLERS['test-pj'], 'handle').callsFake(() => Promise.resolve(new Response('# content')));

    // head requests: twice per file (isNotModified + storage.metadata in update)
    for (let i = 0; i < PURGE_ALL_CONTENT_THRESHOLD + 5; i += 1) {
      nock.content(CONTENT_BUS_ID).headObject(`/preview/doc${i}.md`).times(2).reply(404);
    }

    // S3 put requests for all documents
    for (let i = 0; i < PURGE_ALL_CONTENT_THRESHOLD + 5; i += 1) {
      nock.content(CONTENT_BUS_ID).putObject(`/preview/doc${i}.md`).reply(201);
    }

    nock('https://sns.us-east-1.amazonaws.com:443').post('/').reply(200, SNS_RESPONSE_BODY);

    const largePaths = largeFileList.map(({ path }) => path);
    const job = await createJob(ctx, info, largePaths);
    await job.run();

    // When > threshold, should purge with the bulk key
    assert.deepStrictEqual(purgeInfos, [
      { key: 'p_foo-id' },
    ]);
  });

  it('processFile() retries on 429 rate limit response', async function retries429() {
    // eslint-disable-next-line no-invalid-this
    this.timeout(5000); // sleep(1000) is called once by the retry logic

    const handleStub = sandbox.stub(HANDLERS['test-pj'], 'handle');
    handleStub.onFirstCall().returns(new Response('', {
      status: 429,
      headers: { 'retry-after': '0' }, // parseInt('0') || 1 = 1 → sleep(1000ms)
    }));
    handleStub.onSecondCall().callsFake(() => Promise.resolve(new Response('# content')));

    nock.content(CONTENT_BUS_ID)
      .headObject('/preview/foo/new.md').reply(404) // isNotModified
      .headObject('/preview/foo/new.md')
      .optionally()
      .reply(404) // storage.metadata
      .putObject('/preview/foo/new.md')
      .reply(201);

    const job = await createJob(ctx, info, ['/foo/new']);
    const file = {
      path: '/foo/new',
      resourcePath: '/foo/new.md',
      source: { lastModified: 1000 },
      status: 0,
    };
    await job.processFile(file, false, { release() {} });

    assert.strictEqual(file.status, 200);
    assert.strictEqual(handleStub.callCount, 2);
  });

  it('processFile() updates redirect purge after processing redirects.json', async () => {
    sandbox.stub(HANDLERS['test-pj'], 'handleJSON').callsFake(() => Promise.resolve(
      new Response('{"data":[]}', { headers: { 'content-type': 'application/json' } }),
    ));

    nock.content(CONTENT_BUS_ID)
      .headObject('/preview/redirects.json').reply(404) // isNotModified
      .headObject('/preview/redirects.json')
      .optionally()
      .reply(404) // storage.metadata
      .putObject('/preview/redirects.json')
      .reply(201)
      .getObject('/preview/redirects.json')
      .reply(200, { data: [{ source: '/foo', destination: '/foo/new2' }] }) // getRedirects() after preview
      .headObject('/preview/foo.md')
      .reply(200) // redirected path
      .copyObject('/preview/foo.md')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '123',
        },
      }));

    ctx.attributes.redirects = {
      preview: {
        '/foo.md': '/foo2',
      },
    };
    const job = await createJob(ctx, info, ['/redirects.json']);
    const file = {
      path: '/redirects.json',
      resourcePath: '/redirects.json',
      redirects: true,
      source: { lastModified: 1000 },
      status: 0,
    };
    job.state.data.resources = [file];
    await job.processFile(file, false, { release() {} });

    assert.strictEqual(file.status, 200);
    assert.deepStrictEqual(purgeInfos, [{ key: 'p_q_WwvA4cJdubPLB2' }, { path: '/foo' }]);
  });

  it('processConfigFiles() calls purge.config when a metadata resource was updated', async () => {
    const job = await createJob(ctx, info, ['/metadata.json']);
    job.state.data.resources = [
      { path: '/metadata.json', resourcePath: '/metadata.json', status: 200 },
    ];

    await job.processConfigFiles();
    assert.deepStrictEqual(purgeInfos, [{ key: 'U_NW4adJU7Qazf-I' }]);
  });

  it('processFile() records errorCode when x-error-code header is present', async () => {
    sandbox.stub(HANDLERS['test-pj'], 'handle').returns(
      new Response('err', { status: 500, headers: { 'x-error': 'upstream error', 'x-error-code': 'ERR_CODE' } }),
    );

    nock.content(CONTENT_BUS_ID).headObject('/preview/foo/new.md').reply(404); // isNotModified

    const job = await createJob(ctx, info, ['/foo/new']);
    job.state.data.resources = [];
    const file = {
      path: '/foo/new', resourcePath: '/foo/new.md', source: { lastModified: 1000 }, status: 0,
    };
    await job.processFile(file, false, { release() {} });

    assert.strictEqual(file.error, 'upstream error');
    assert.strictEqual(file.errorCode, 'ERR_CODE');
    assert.strictEqual(job.state.progress.failed, 1);
  });

  it('processFile() records error and increments failed count on x-error response', async () => {
    sandbox.stub(HANDLERS['test-pj'], 'handle').returns(
      new Response('err', { status: 500, headers: { 'x-error': 'upstream error' } }),
    );

    nock.content(CONTENT_BUS_ID).headObject('/preview/foo/new.md').reply(404); // isNotModified

    const job = await createJob(ctx, info, ['/foo/new']);
    job.state.data.resources = [];
    const file = {
      path: '/foo/new', resourcePath: '/foo/new.md', source: { lastModified: 1000 }, status: 0,
    };
    await job.processFile(file, false, { release() {} });

    assert.strictEqual(file.error, 'upstream error');
    assert.strictEqual(job.state.progress.failed, 1);
  });

  it('preview() aborts without calling processFile when checkStopped returns true', async () => {
    const job = await createJob(ctx, info, ['/foo/new']);
    job.state.data.resources = [{
      path: '/foo/new', resourcePath: '/foo/new.md', source: { lastModified: 1000 }, status: 0,
    }];
    job.state.data.forceUpdate = false;
    job.checkStopped = sinon.stub().resolves(true);

    await job.preview();

    // processFile was never called — file status is still 0
    assert.strictEqual(job.state.data.resources[0].status, 0);
  });
});
