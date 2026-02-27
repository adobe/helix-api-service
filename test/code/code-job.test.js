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
/* eslint-disable max-len, max-classes-per-file,no-param-reassign */
import assert from 'assert';
import path from 'path';
import { promises as fs } from 'fs';
import sinon, { useFakeTimers } from 'sinon';
import { Octokit } from '@octokit/rest';
import { computeSurrogateKey } from '@adobe/helix-shared-utils';
import { sanitizeName } from '@adobe/helix-shared-string';
import {
  createContext, createInfo,
  Nock, SITE_CONFIG,
} from '../utils.js';
import { CodeJob, getCodeRef } from '../../src/code/code-job.js';
import { StatusCodeError } from '../../src/support/StatusCodeError.js';
import { getCodeSource } from '../../src/code/github-bot.js';
import { JobStorage } from '../../src/job/storage.js';
import { RateLimitError } from '../../src/code/rate-limit-error.js';

const DEFAULT_OCTOKIT = (ctx) => new Octokit({
  request: { fetch: ctx.getFetch() },
  auth: 'token foo-token',
  log: ctx.log,
});

class MockBucket {
  constructor() {
    this.added = [];
    this.removed = [];
    this.rmdirs = [];
    this.copys = [];
    this.avail = {};
    this.meta = {};
  }

  withFile(filePath, data = '') {
    if (typeof data === 'object') {
      // eslint-disable-next-line no-param-reassign
      data = Buffer.from(JSON.stringify(data), 'utf-8');
    } else {
      // eslint-disable-next-line no-param-reassign
      data = Buffer.from(String(data), 'utf-8');
    }
    this.avail[filePath] = data;
    return this;
  }

  withMeta(filePath, meta) {
    this.meta[filePath] = meta;
    return this;
  }

  async get(filePath) {
    if (filePath.indexOf('/fail/') >= 0) {
      throw new Error('get error');
    }
    return this.avail[filePath];
  }

  async head(filePath) {
    return this.meta[filePath] ?? (this.avail[filePath] ? {} : null);
  }

  async put(filePath, body, contentType, meta, compressed = true) {
    if (filePath.indexOf('/fail/') >= 0) {
      throw new Error('put error');
    }
    this.added.push({
      filePath,
      body: body.toString('utf-8'),
      contentType,
      meta,
      compressed,
    });
  }

  async remove(filePath) {
    if (filePath.indexOf('/fail/') >= 0) {
      throw new Error('remove error');
    }
    this.removed.push(filePath);
  }

  async rmdir(filePath) {
    this.rmdirs.push(filePath);
  }

  async list(prefix) {
    return Object.entries(this.avail)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key]) => ({
        path: key.substring(prefix.length),
      }));
  }

  async copyDeep(src, dst, filter) {
    this.copys.push({ src, dst });
    return Object
      .entries(this.avail)
      .filter(([key]) => key.startsWith(src))
      .map(([key, data]) => ({
        path: key.substring(src.length),
        lastModified: '',
        contentType: 'text/plain',
        contentLength: data ? data.length : 0,
      }))
      .filter(filter);
  }
}

class MockStorageS3 {
  constructor() {
    this._codeBus = new MockBucket();
    this._contentBus = new MockBucket();
    this._configBus = new MockBucket();
  }

  codeBus() {
    return this._codeBus;
  }

  contentBus() {
    return this._contentBus;
  }

  configBus() {
    return this._configBus;
  }
}

function removeLastModified(resources) {
  resources
    .forEach((r) => { delete r.lastModified; });
}

/**
 * Creates a mock CodeJob
 * @param ctx
 * @param info
 * @return {Promise<CodeJob>}
 */
const createJob = async (ctx, event = {}, sandbox) => {
  // augment test event if not setup correctly yet
  event.codeRef = event.codeRef || sanitizeName(event.ref);
  event.codeRepo = event.codeRepo || sanitizeName(event.repo);
  event.codeOwner = event.codeOwner || sanitizeName(event.owner);
  event.codePrefix = event.codePrefix || `/${event.codeOwner}/${event.codeRepo}/${event.codeRef}/`;
  const info = createInfo(`/${event.codeOwner}/repos/${event.codeRepo}/code/${event.codeRef}`)
    .withCode(event.owner, event.repo)
    .withRef(event.ref);
  const actions = [];
  if (sandbox) {
    // sandbox.stub(CodeJob, 'reindexProject').callsFake(() => { actions.push('deployFstab'); });
    // sandbox.stub(CodeJob, 'reindexProject').callsFake(() => { actions.push('deployFstab'); });
    // MockedCodeJob = (await esmock('../../src/codebus/code-job.js', {
    //   '../../src/support/deploy-fstab.js': {
    //     deployFstab: () => { actions.push('deployFstab'); },
    //   },
    //   '../../src/discover/reindex.js': {
    //     reindexProject: () => { actions.push('discoverReindex'); },
    //   },
    //   '../../src/cache/purge.js': {
    //     performPurge: (...args) => { actions.push({ name: 'performPurge', args }); },
    //     purgeCode: (...args) => { actions.push({ name: 'purgeCode', args }); },
    //   },
    //   '../../src/contentbus/config-merge.js': {
    //     contentConfigMerge: () => {
    //       actions.push('config-merge');
    //     },
    //   },
    // })).CodeJob;
  }
  const storage = await JobStorage.create(ctx, info, CodeJob);
  const job = new CodeJob(ctx, info, 'code', 'job-123', storage)
    .withTransient(true);
  job.state = {
    data: {
      ...event,
      installationId: 42,
      // technically not present from the beginning
      resources: [],
    },
  };
  job.mockActions = actions;
  await job.trackProgress({
    total: 0,
  });
  return job;
};

function replyConfigPurge(...keys) {
  return async (_, body) => {
    assert.deepStrictEqual(body, {
      surrogate_keys: [
        await computeSurrogateKey('repo--owner_config.json'),
        ...keys,
      ],
    });
    return [200];
  };
}

function replyPurge(...keys) {
  return async (_, body) => {
    assert.deepStrictEqual(body, {
      surrogate_keys: keys,
    });
    return [200];
  };
}

describe('Code Job tests', () => {
  let nock;
  let ctx;
  let storage;
  let codeBus;
  let configBus;
  let contentBus;
  let sandbox;
  beforeEach(() => {
    nock = new Nock().env();
    storage = new MockStorageS3();
    codeBus = storage.codeBus();
    contentBus = storage.contentBus();
    configBus = storage.configBus();
    sandbox = sinon.createSandbox();
    ctx = createContext('/owner/repos/repo/code/main/*', {
      attributes: {
        storage,
      },
      env: {
        HLX_FASTLY_PURGE_TOKEN: '1234',
      },
    });
    ctx.attributes.octokits = {
      42: DEFAULT_OCTOKIT(ctx),
    };
    ctx.attributes.installations = {
      'owner/repo': {
        id: 42,
      },
    };
  });

  afterEach(() => {
    nock.done();
    sandbox.restore();

  });

  it('job rejects resume during collect', async () => {
    const job = await createJob(ctx, { owner: 'owner', repo: 'repo', ref: 'ref' });
    job.state.data.phase = 'collect';
    await assert.rejects(job.run(), Error('job cannot be resumed during the collect phase. please provide a smaller input set.'));
  });

  it('run invokes all the phases', async () => {
    const job = await createJob(ctx, {
      owner: 'owner', repo: 'repo', ref: 'ref', deploymentAllowed: false, changes: [],
    });
    job.collect = () => {};
    job.sync = () => {};
    job.postProcess = () => {};
    job.flushCache = () => {};
    await job.run();
    assert.strictEqual(job.state.data.phase, 'completed');
    assert.deepStrictEqual(job.state.progress, {
      failed: 0,
      ignored: 0,
      processed: 0,
      total: 0,
    });
  });

  it('job rejects resume during collect unless in was in retry loop ', async () => {
    const job = await createJob(ctx, {
      owner: 'owner', repo: 'repo', ref: 'ref', deploymentAllowed: false, changes: [],
    });
    job.state.data.phase = 'collect';
    job.state.waiting = 100;
    job.collect = () => {};
    job.sync = () => {};
    job.postProcess = () => {};
    job.flushCache = () => {};
    await job.run();
    assert.strictEqual(job.state.data.phase, 'completed');
    assert.deepStrictEqual(job.state.progress, {
      failed: 0,
      ignored: 0,
      processed: 0,
      total: 0,
    });
  });

  it('updates progress', async () => {
    const job = await createJob(ctx, {
      owner: 'owner', repo: 'repo', ref: 'ref', deploymentAllowed: false,
    });
    job.collect = () => {
      const { state: { data } } = job;
      data.resources = [{}];
      data.changes = [{
        type: 'ignored',
      }];
    };
    job.sync = () => {};
    job.postProcess = () => {};
    job.flushCache = () => {};
    await job.run();
    assert.strictEqual(job.state.data.phase, 'completed');
    assert.deepStrictEqual(job.state.progress, {
      failed: 0,
      ignored: 0, // ignored is counted during sync
      processed: 0,
      total: 1,
    });
  });

  it('run updates deployments when deploymentId is defined', async () => {
    const reqs = [];
    nock('https://api.github.com')
      .post('/repos/owner/repo/deployments/123/statuses')
      .times(2)
      .reply((...args) => {
        reqs.push(args);
        return [200];
      });
    const job = await createJob(ctx, {
      owner: 'owner',
      repo: 'repo',
      ref: 'ref',
      deploymentId: '123',
      deploymentAllowed: true,
    });
    job.collect = () => {};
    job.sync = () => {};
    job.postProcess = () => {};
    job.flushCache = () => {};
    await job.run();
    assert.deepStrictEqual(reqs[0], [
      '/repos/owner/repo/deployments/123/statuses',
      {
        environment_url: 'https://ref--repo--owner.aem.page',
        log_url: 'https://api.aem.live/owner/sites/repo/jobs/code/job-123',
        state: 'in_progress',
      },
    ]);
    assert.deepStrictEqual(reqs[1], [
      '/repos/owner/repo/deployments/123/statuses',
      {
        environment_url: 'https://ref--repo--owner.aem.page',
        log_url: 'https://api.aem.live/owner/sites/repo/jobs/code/job-123',
        state: 'success',
      },
    ]);
    assert.strictEqual(job.state.data.phase, 'completed');
  });

  it('run updates deployment to failure if not in completed phase', async () => {
    const reqs = [];
    nock('https://api.github.com')
      .post('/repos/owner/repo/deployments/123/statuses')
      .times(2)
      .reply((...args) => {
        reqs.push(args);
        return [200];
      });

    const job = await createJob(ctx, {
      owner: 'owner',
      repo: 'repo',
      ref: 'ref',
      deploymentId: '123',
      deploymentAllowed: true,
    });
    job.collect = () => {};
    job.sync = () => {};
    job.postProcess = () => {};
    job.flushCache = () => {};
    job.setPhase = (pphase) => {
      // force completed phase to something unexpected
      job.state.data.phase = pphase === 'completed' ? 'unexpected' : pphase;
    };
    await job.run();
    assert.deepStrictEqual(reqs[0], [
      '/repos/owner/repo/deployments/123/statuses',
      {
        environment_url: 'https://ref--repo--owner.aem.page',
        log_url: 'https://api.aem.live/owner/sites/repo/jobs/code/job-123',
        state: 'in_progress',
      },
    ]);
    assert.deepStrictEqual(reqs[1], [
      '/repos/owner/repo/deployments/123/statuses',
      {
        environment_url: 'https://ref--repo--owner.aem.page',
        log_url: 'https://api.aem.live/owner/sites/repo/jobs/code/job-123',
        state: 'failure',
      },
    ]);
    assert.strictEqual(job.state.data.phase, 'unexpected');
  });

  it('run skips deployment update if missing permissions', async () => {
    const reqs = [];
    nock('https://api.github.com')
      .post('/repos/owner/repo/deployments/123/statuses')
      .reply((...args) => {
        reqs.push(args);
        return [403, 'Resource not accessible by integration'];
      });

    const job = await createJob(ctx, {
      owner: 'owner',
      repo: 'repo',
      ref: 'ref',
      deploymentId: '123',
      deploymentAllowed: true,
    });
    job.collect = () => {};
    job.sync = () => {};
    job.postProcess = () => {};
    job.flushCache = () => {};
    await job.run();
    assert.deepStrictEqual(reqs[0], [
      '/repos/owner/repo/deployments/123/statuses',
      {
        environment_url: 'https://ref--repo--owner.aem.page',
        log_url: 'https://api.aem.live/owner/sites/repo/jobs/code/job-123',
        state: 'in_progress',
      },
    ]);
    assert.strictEqual(job.state.data.phase, 'completed');
  });

  it('run updates completed deployment if error on in_progress is not permissions issue', async () => {
    const resps = [[400, 'something went wrong'], [200]];
    const reqs = [];
    nock('https://api.github.com')
      .post('/repos/owner/repo/deployments/123/statuses')
      .times(2)
      .reply((...args) => {
        reqs.push(args);
        return resps[reqs.length - 1];
      });

    const job = await createJob(ctx, {
      owner: 'owner',
      repo: 'repo',
      ref: 'ref',
      deploymentId: '123',
      deploymentAllowed: true,
    });
    job.collect = () => {};
    job.sync = () => {};
    job.postProcess = () => {};
    job.flushCache = () => {};
    await job.run();
    assert.deepStrictEqual(reqs[0], [
      '/repos/owner/repo/deployments/123/statuses',
      {
        environment_url: 'https://ref--repo--owner.aem.page',
        log_url: 'https://api.aem.live/owner/sites/repo/jobs/code/job-123',
        state: 'in_progress',
      },
    ]);
    assert.deepStrictEqual(reqs[1], [
      '/repos/owner/repo/deployments/123/statuses',
      {
        environment_url: 'https://ref--repo--owner.aem.page',
        log_url: 'https://api.aem.live/owner/sites/repo/jobs/code/job-123',
        state: 'success',
      },
    ]);
    assert.strictEqual(job.state.data.phase, 'completed');
  });

  it('run creates deployment if no deploymentId provided', async () => {
    const resps = [[200, { id: 123 }], [200], [200]];
    const reqs = [];
    nock('https://api.github.com')
      .post('/repos/owner/repo/deployments')
      .reply((...args) => {
        reqs.push(args);
        return resps[reqs.length - 1];
      })
      .post('/repos/owner/repo/deployments/123/statuses')
      .times(2)
      .reply((...args) => {
        reqs.push(args);
        return resps[reqs.length - 1];
      });

    const job = await createJob(ctx, {
      owner: 'owner',
      repo: 'repo',
      ref: 'ref',
      deploymentId: undefined,
      deploymentAllowed: true,
    });
    job.collect = () => {};
    job.sync = () => {};
    job.postProcess = () => {};
    job.flushCache = () => {};
    await job.run();
    assert.deepStrictEqual(reqs[0], [
      '/repos/owner/repo/deployments',
      {
        environment: 'ref',
        payload: {},
        ref: 'ref',
        required_contexts: [],
        task: 'aem-code-sync',
        auto_merge: false,
      },
    ]);
    assert.deepStrictEqual(reqs[1], [
      '/repos/owner/repo/deployments/123/statuses',
      {
        environment_url: 'https://ref--repo--owner.aem.page',
        log_url: 'https://api.aem.live/owner/sites/repo/jobs/code/job-123',
        state: 'in_progress',
      },
    ]);
    assert.deepStrictEqual(reqs[2], [
      '/repos/owner/repo/deployments/123/statuses',
      {
        environment_url: 'https://ref--repo--owner.aem.page',
        log_url: 'https://api.aem.live/owner/sites/repo/jobs/code/job-123',
        state: 'success',
      },
    ]);
    assert.strictEqual(job.state.data.phase, 'completed');
  });

  it('run skips deployment update if create fails', async () => {
    const reqs = [];
    nock('https://api.github.com')
      .post('/repos/owner/repo/deployments')
      .reply((...args) => {
        reqs.push(args);
        return [500, 'something went wrong'];
      });

    const job = await createJob(ctx, {
      owner: 'owner',
      repo: 'repo',
      ref: 'ref',
      deploymentId: undefined,
      deploymentAllowed: true,
    });
    job.collect = () => {};
    job.sync = () => {};
    job.postProcess = () => {};
    job.flushCache = () => {};
    await job.run();
    assert.deepStrictEqual(reqs[0], [
      '/repos/owner/repo/deployments',
      {
        environment: 'ref',
        payload: {},
        ref: 'ref',
        required_contexts: [],
        task: 'aem-code-sync',
        auto_merge: false,
      },
    ]);
    assert.strictEqual(job.state.data.phase, 'completed');
  });

  it('run skips deployment update if missing permissions during create', async () => {
    const reqs = [];
    nock('https://api.github.com')
      .post('/repos/owner/repo/deployments')
      .reply((...args) => {
        reqs.push(args);
        return [403, 'Resource not accessible by integration'];
      });

    const job = await createJob(ctx, {
      owner: 'owner',
      repo: 'repo',
      ref: 'ref',
      deploymentId: undefined,
      deploymentAllowed: true,
    });
    job.collect = () => {};
    job.sync = () => {};
    job.postProcess = () => {};
    job.flushCache = () => {};
    await job.run();
    assert.deepStrictEqual(reqs[0], [
      '/repos/owner/repo/deployments',
      {
        environment: 'ref',
        payload: {},
        ref: 'ref',
        required_contexts: [],
        task: 'aem-code-sync',
        auto_merge: false,
      },
    ]);
    assert.strictEqual(job.state.data.phase, 'completed');
  });

  it('extracts extra history info', async () => {
    const job = await createJob(ctx, {
      owner: 'owner',
      repo: 'repo',
      ref: 'ref',
      deploymentId: undefined,
      deploymentAllowed: true,
    });
    assert.deepStrictEqual(job.extractHistoryExtraInfo({}), {});
    assert.deepStrictEqual(job.extractHistoryExtraInfo({
      data: {
        branch: 'main',
      },
    }), { branch: 'main' });
  });

  describe('runWithRetry tests', () => {
    let clock;
    beforeEach(() => {
      clock = useFakeTimers({
        toFake: ['Date'],
      });
    });

    afterEach(() => {
      clock.restore();
    });

    it('runWithRetry invokes idleWait on rate limit errors.', async () => {
      const job = await createJob(ctx, {
        owner: 'owner', repo: 'repo', ref: 'ref', changes: [],
      });
      const waits = [];
      job.idleWait = (timeout) => {
        waits.push(timeout);
      };
      let fnCount = 0;
      const fn = () => {
        fnCount += 1;
        if (fnCount === 1) {
          throw new RateLimitError('first error', 0, 0);
        } else if (fnCount === 2) {
          throw new RateLimitError('second error', 0, (Date.now() + 5000) / 1000);
        } else if (fnCount === 3) {
          throw new RateLimitError('second error', 30);
        }
      };

      await job.runWithRetry(fn, 'test', null);
      assert.deepStrictEqual(waits, [0, 60_000, 5_000, 30_000]);
      assert.deepStrictEqual(fnCount, 4);
    });
  });

  describe('collect phase', () => {
    let codeSource;
    beforeEach(async () => {
      codeSource = {
        owner: 'owner',
        repo: 'repo',
        ref: 'ref',
        branch: 'ref',
        octokit: {},
        raw_url: 'https://raw.githubusercontent.com',
        base_url: 'https://api.github.com',
      };
    });

    it('handles branch deletion', async () => {
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-deleted.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      await job.collect(codeSource);
      assert.deepStrictEqual(job.state.data.resources, [
        {
          deleted: true,
          resourcePath: '/*',
          status: 200,
        },
      ]);
      assert.strictEqual(job.state.data.deleteTree, true);
    });

    it('handles branch deletion on main', async () => {
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-deleted.json'), 'utf-8'));
      events.ref = 'main';
      const job = await createJob(ctx, events);
      await assert.rejects(job.collect(codeSource), Error('[/owner/repo/main/] cowardly refusing to delete potential default branch.'));
    });

    it('collects changes from events', async () => {
      nock.mockIgnore();
      nock('https://api.github.com')
        .get('/repos/owner/repo/branches/ref')
        .reply(200, {
          name: 'ref',
          commit: {
            sha: 'e7dc0087d4b2f8d37f6f5c233655e9d34add005e',
          },
        })
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await job.collect(codeSource);
      assert.deepStrictEqual(job.state.data.changes, events.changes);
      assert.deepStrictEqual(job.state.data.resources, []);
      assert.deepStrictEqual(job.state.data.configChanges, undefined);
    });

    it('handles branch creation', async () => {
      nock.mockIgnore({
        route: '/owner/repo/new-branch/.hlxignore',
      });
      nock('https://api.github.com')
        .get('/repos/owner/repo/branches/new-branch')
        .reply(200, {
          name: 'ref',
          commit: {
            sha: '5edf98811d50b5b948f6f890f0c4367095490dbd',
          },
        })
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      codeBus
        .withFile('/owner/repo/ref/.sha')
        .withFile('/owner/repo/ref/styles/styles.js', 'alert("hello, world")');
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await job.collect(codeSource);
      assert.deepStrictEqual(job.state.data.changes, [{
        commit: '5edf98811d50b5b948f6f890f0c4367095490dbd',
        contentType: 'text/markdown; charset=utf-8',
        path: 'foo.md',
        time: '2021-05-04T13:40:15+09:00',
        type: 'added',
      }]);
      removeLastModified(job.state.data.resources);
      assert.deepStrictEqual(job.state.data.resources, [{
        contentLength: 21,
        contentType: 'text/plain',
        resourcePath: '/styles/styles.js',
        status: 200,
      }]);
      assert.deepStrictEqual(job.state.data.configChanges, undefined);
      assert.deepEqual(codeBus.added, []);
      assert.deepEqual(codeBus.removed, []);
      delete codeBus.copys[0].filter;
      assert.deepEqual(codeBus.copys, [{
        dst: '/owner/repo/new-branch/',
        src: '/owner/repo/ref/',
      }]);
    });

    it('handles branch creation, using .hlxignore from new branch', async () => {
      nock.mockIgnore({
        route: '/owner/repo/new-branch/.hlxignore',
        status: 200,
        content: '**.md\n**/*.json\n',
      });
      nock('https://api.github.com')
        .get('/repos/owner/repo/branches/new-branch')
        .reply(200, {
          name: 'ref',
          commit: {
            sha: '5edf98811d50b5b948f6f890f0c4367095490dbd',
          },
        })
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      codeBus
        .withFile('/owner/repo/ref/.sha')
        .withFile('/owner/repo/ref/styles/readme.md')
        .withFile('/owner/repo/ref/package.json');

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await job.collect(codeSource);
      removeLastModified(job.state.data.resources);
      assert.deepStrictEqual(job.state.data.resources, []);
    });

    it('handles rate limit error from hlxignore', async () => {
      nock('https://raw.githubusercontent.com')
        .get('/owner/repo/new-branch/.hlxignore')
        .reply(429);
      nock('https://api.github.com')
        .get('/repos/owner/repo/contents/.hlxignore?ref=new-branch')
        .reply(429);
      codeBus
        .withFile('/owner/repo/ref/.sha')
        .withFile('/owner/repo/ref/styles/readme.md')
        .withFile('/owner/repo/ref/package.json');

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      await assert.rejects(job.collect(codeSource), Error('error reading content from github. (url=https://api.github.com/repos/owner/repo/contents/.hlxignore?ref=new-branch, branch=undefined)'));
    });

    it('handles rate limit error from hlxignore (no retry for byogit)', async () => {
      codeSource.installationId = 'byogit';
      nock('https://raw.githubusercontent.com')
        .get('/owner/repo/new-branch/.hlxignore')
        .reply(429);
      codeBus
        .withFile('/owner/repo/ref/.sha')
        .withFile('/owner/repo/ref/styles/readme.md')
        .withFile('/owner/repo/ref/package.json');

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      await assert.rejects(job.collect(codeSource), Error('error reading content from github. (url=https://raw.githubusercontent.com/owner/repo/new-branch/.hlxignore, branch=undefined)'));
    });

    it('handles forbidden error from hlxignore', async () => {
      nock('https://raw.githubusercontent.com')
        .get('/owner/repo/new-branch/.hlxignore')
        .reply(403);
      codeBus
        .withFile('/owner/repo/ref/.sha')
        .withFile('/owner/repo/ref/styles/readme.md')
        .withFile('/owner/repo/ref/package.json');

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      await assert.rejects(job.collect(codeSource), Error('Unable to fetch hlxignore: 403'));
    });

    it('branch creation with no base ref causes tree sync', async () => {
      nock.mockIgnore({ route: '/aemsites/repo/new-branch/.hlxignore' });
      nock('https://api.github.com')
        .get('/repos/aemsites/repo/branches/new-branch')
        .reply(200, {
          name: 'ref',
          commit: {
            sha: '5edf98811d50b5b948f6f890f0c4367095490dbd',
          },
        })
        .get('/repos/aemsites/repo/git/trees/5edf98811d50b5b948f6f890f0c4367095490dbd?recursive=true')
        .reply(200, {
          sha: '9420200f75e3d1a252d1d8711241dba4f6081af0',
          url: 'https://api.github.com/repos/aemsites/helix-test/git/trees/5edf98811d50b5b948f6f890f0c4367095490dbd',
          tree: [{
            path: '5-bsl.md',
            mode: '100644',
            type: 'blob',
            sha: '3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
            size: 4802,
            url: 'https://api.github.com/repos/aemsites/helix-test/git/blobs/3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
          }, {
            path: 'bar.md',
            mode: '100644',
            type: 'blob',
            sha: '3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
            size: 4802,
            url: 'https://api.github.com/repos/owner/helix-test/git/blobs/3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
          }, {
            path: 'invalid path.md',
            mode: '100644',
            type: 'blob',
            sha: '3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
            size: 4802,
            url: 'https://api.github.com/repos/aemsites/helix-test/git/blobs/3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
          }, {
            path: 'helix-config.json',
            mode: '100644',
            type: 'blob',
            sha: '3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
            size: 4802,
            url: 'https://api.github.com/repos/aemsites/helix-test/git/blobs/3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
          }, {
            path: '',
            mode: '100644',
            type: 'blob',
            sha: '3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
            size: 4802,
            url: 'https://api.github.com/repos/aemsites/helix-test/git/blobs/3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
          }],
          truncated: false,
        }, {
          'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT',
        })
        .get('/rate_limit')
        .times(2)
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      codeBus
        .withFile('aemsites/repo/new-branch/helix-config.json')
        .withFile('aemsites/repo/new-branch/styles/readme.md')
        .withFile('aemsites/repo/new-branch/bar.md')
        .withFile('aemsites/repo/new-branch/package.json');

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-created.json'), 'utf-8'));
      events.baseRef = '';
      events.owner = 'aemsites';
      const job = await createJob(ctx, events);
      codeSource.owner = 'aemsites';
      codeSource.octokit = ctx.attributes.octokits['42'];
      await job.collect(codeSource);
      assert.deepStrictEqual(job.state.data.resources, []);
      assert.deepStrictEqual(job.state.data.changes, [{
        commit: '9420200f75e3d1a252d1d8711241dba4f6081af0',
        path: '5-bsl.md',
        contentType: 'text/markdown; charset=utf-8',
        type: 'added',
      },
      {
        commit: '9420200f75e3d1a252d1d8711241dba4f6081af0',
        path: 'bar.md',
        contentType: 'text/markdown; charset=utf-8',
        type: 'modified',
      }, {
        commit: '9420200f75e3d1a252d1d8711241dba4f6081af0',
        contentType: 'text/markdown; charset=utf-8',
        path: 'invalid path.md',
        type: 'ignored',
      }, {
        commit: '9420200f75e3d1a252d1d8711241dba4f6081af0',
        contentType: 'application/json',
        path: 'helix-config.json',
        type: 'ignored',
      }, {
        commit: '9420200f75e3d1a252d1d8711241dba4f6081af0',
        contentType: 'application/octet-stream',
        path: '',
        type: 'ignored',
      },
      {
        contentType: 'text/markdown; charset=utf-8',
        path: 'styles/readme.md',
        type: 'deleted',
      },
      {
        contentType: 'application/json',
        path: 'package.json',
        type: 'deleted',
      }]);
    });

    it('commit with .hlxignore causes tree sync (on tag)', async () => {
      nock.mockIgnore({
        route: '/owner/repo/v1/.hlxignore',
        status: 200,
        content: '**.md\n**/*.json\n',
      });
      nock('https://api.github.com')
        .get('/repos/owner/repo/git/ref/tags%2Fv1')
        .reply(200, {
          name: 'v1',
          object: {
            sha: 'e7dc0087d4b2f8d37f6f5c233655e9d34add005e',
          },
        })
        .get('/repos/owner/repo/git/trees/e7dc0087d4b2f8d37f6f5c233655e9d34add005e?recursive=true')
        .reply(200, {
          sha: '9420200f75e3d1a252d1d8711241dba4f6081af0',
          url: 'https://api.github.com/repos/owner/helix-test/git/trees/9420200f75e3d1a252d1d8711241dba4f6081af0',
          tree: [{
            path: '.hlxignore',
            type: 'blob',
            sha: '3ffae8403001ce895348ccf6ebd5d74f249d8bdb',
            size: 4802,
          }, {
            path: 'README.md',
            type: 'blob',
            sha: '5edf98811d50b5b948f6f890f0c4367095490dbd',
            size: 4701,

          }],
          truncated: false,
        }, {
          'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT',
        })
        .get('/rate_limit')
        .times(2)
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-ignore.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await job.collect(codeSource);
      assert.deepStrictEqual(job.state.data.resources, []);
      assert.deepStrictEqual(job.state.data.changes, [{
        commit: '9420200f75e3d1a252d1d8711241dba4f6081af0',
        contentType: 'application/octet-stream',
        path: '.hlxignore',
        type: 'added',
      }, {
        commit: '9420200f75e3d1a252d1d8711241dba4f6081af0',
        path: 'README.md',
        contentType: 'text/markdown; charset=utf-8',
        type: 'ignored',
      }]);
    });

    it('commit with tag causes tree sync', async () => {
      nock.mockIgnore({ route: '/owner/repo/new-tag/.hlxignore' });
      nock('https://api.github.com')
        .get('/repos/owner/repo/git/ref/tags%2Fnew-tag')
        .reply(200, {
          name: 'ref',
          object: {
            sha: 'e7dc0087d4b2f8d37f6f5c233655e9d34add005e',
          },
        })
        .get('/repos/owner/repo/git/trees/e7dc0087d4b2f8d37f6f5c233655e9d34add005e?recursive=true')
        .reply(200, {
          sha: '9420200f75e3d1a252d1d8711241dba4f6081af0',
          url: 'https://api.github.com/repos/owner/helix-test/git/trees/9420200f75e3d1a252d1d8711241dba4f6081af0',
          tree: [],
          truncated: false,
        }, {
          'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT',
        })
        .get('/rate_limit')
        .times(2)
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-tag-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await job.collect(codeSource);
      // removeLastModified(job.state.data.resources);
      assert.deepStrictEqual(job.state.data.resources, []);
      // note: usually it would include all results from the tree listing, but we omit it here for brevity
      assert.deepStrictEqual(job.state.data.changes, []);
    });

    it('tree sync handles truncated result', async () => {
      nock.mockIgnore({ route: '/owner/repo/new-tag/.hlxignore' });
      nock('https://api.github.com')
        .get('/repos/owner/repo/git/ref/tags%2Fnew-tag')
        .reply(200, {
          name: 'ref',
          object: {
            sha: 'e7dc0087d4b2f8d37f6f5c233655e9d34add005e',
          },
        })
        .get('/repos/owner/repo/git/trees/e7dc0087d4b2f8d37f6f5c233655e9d34add005e?recursive=true')
        .reply(200, {
          sha: '9420200f75e3d1a252d1d8711241dba4f6081af0',
          url: 'https://api.github.com/repos/owner/helix-test/git/trees/9420200f75e3d1a252d1d8711241dba4f6081af0',
          tree: [],
          truncated: true,
        }, {
          'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT',
        })
        .get('/rate_limit')
        .times(1)
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-tag-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await assert.rejects(job.collect(codeSource), Error('Unable to list tree for owner/repo/new-tag: tree too large to sync. rejecting truncated result.'));
    });

    it('tree sync handles unauthorized result', async () => {
      nock.mockIgnore({ route: '/owner/repo/new-tag/.hlxignore' });
      nock('https://api.github.com')
        .get('/repos/owner/repo/git/ref/tags%2Fnew-tag')
        .reply(200, {
          name: 'ref',
          object: {
            sha: 'e7dc0087d4b2f8d37f6f5c233655e9d34add005e',
          },
        })
        .get('/repos/owner/repo/git/trees/e7dc0087d4b2f8d37f6f5c233655e9d34add005e?recursive=true')
        .reply(401)
        .get('/rate_limit')
        .times(1)
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-tag-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await assert.rejects(job.collect(codeSource), new StatusCodeError('Unable to list tree for owner/repo/new-tag: 401', 401));
    });

    it('tree sync handles 429', async () => {
      nock.mockIgnore({ route: '/owner/repo/new-tag/.hlxignore' });
      nock('https://api.github.com')
        .get('/repos/owner/repo/git/ref/tags%2Fnew-tag')
        .reply(200, {
          name: 'ref',
          object: {
            sha: 'e7dc0087d4b2f8d37f6f5c233655e9d34add005e',
          },
        })
        .get('/repos/owner/repo/git/trees/e7dc0087d4b2f8d37f6f5c233655e9d34add005e?recursive=true')
        .reply(429, '', {
          'x-ratelimit-reset': 1625731200,
        })
        .get('/rate_limit')
        .times(1)
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-tag-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await assert.rejects(job.collect(codeSource), new RateLimitError('Unable to list tree for owner/repo/new-tag: 429', 0, 1625731200));
    });

    it('commit new repository causes tree sync', async () => {
      nock.mockIgnore({ route: '/owner/repo/main/.hlxignore' });
      nock('https://api.github.com')
        .get('/repos/owner/repo/branches/main')
        .reply(200, {
          name: 'ref',
          commit: {
            sha: '5edf98811d50b5b948f6f890f0c4367095490dbd',
          },
        })
        .get('/repos/owner/repo/git/trees/5edf98811d50b5b948f6f890f0c4367095490dbd?recursive=true')
        .reply(200, {
          sha: '9420200f75e3d1a252d1d8711241dba4f6081af0',
          url: 'https://api.github.com/repos/owner/helix-test/git/trees/9420200f75e3d1a252d1d8711241dba4f6081af0',
          tree: [],
          truncated: false,
        }, {
          'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT',
        })
        .get('/rate_limit')
        .times(2)
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-new-repo.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await job.collect(codeSource);
      // removeLastModified(job.state.data.resources);
      assert.deepStrictEqual(job.state.data.resources, []);
      // note: usually it would include all results from the tree listing, but we omit it here for brevity
      assert.deepStrictEqual(job.state.data.changes, []);
    });

    it('commit when branch does not exist', async () => {
      nock.mockIgnore({ route: '/owner/repo/new-branch/.hlxignore' });
      nock('https://api.github.com')
        .get('/repos/owner/repo/branches/new-branch')
        .reply(404)
        .get('/rate_limit')
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await assert.rejects(job.collect(codeSource), Error('[/owner/repo/new-branch/] branch not found.'));
    });

    it('commit when .sha does not exist in storage yet causes tree sync', async () => {
      nock.mockIgnore({ route: '/owner/repo/new-branch/.hlxignore' });
      nock('https://api.github.com')
        .get('/repos/owner/repo/branches/new-branch')
        .reply(200, {
          name: 'ref',
          commit: {
            sha: '5edf98811d50b5b948f6f890f0c4367095490dbd',
          },
        })
        .get('/repos/owner/repo/git/trees/5edf98811d50b5b948f6f890f0c4367095490dbd?recursive=true')
        .reply(200, {
          sha: '9420200f75e3d1a252d1d8711241dba4f6081af0',
          url: 'https://api.github.com/repos/owner/helix-test/git/trees/9420200f75e3d1a252d1d8711241dba4f6081af0',
          tree: [{
            path: 'head.html',
            type: 'blob',
            sha: '5edf98811d50b5b948f6f890f0c4367095490dbd',
            size: 4701,
          }],
          truncated: false,
        }, {
          'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT',
        })
        .get('/rate_limit')
        .times(2)
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-created.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await job.collect(codeSource);
      codeSource.octokit = ctx.attributes.octokits['42'];
      assert.deepStrictEqual(job.state.data.resources, []);
    });

    it('commit with config changes', async () => {
      nock.mockIgnore({ route: '/owner/repo/main/.hlxignore' });
      nock('https://api.github.com')
        .get('/repos/owner/repo/branches/main')
        .reply(200, {
          name: 'ref',
          commit: {
            sha: 'e7dc0087d4b2f8d37f6f5c233655e9d34add005e',
          },
        })
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config.json'), 'utf-8'));
      events.changes[1].type = 'DELETED';
      const job = await createJob(ctx, events);
      codeSource.octokit = ctx.attributes.octokits['42'];
      await job.collect(codeSource);
      assert.deepStrictEqual(job.state.data.resources, []);
      assert.deepStrictEqual(job.state.data.changes, events.changes);
      assert.deepStrictEqual(job.state.data.changes[1].type, 'deleted');
    });
  });

  describe('sync phase', () => {
    it('syncs events', async () => {
      nock('https://raw.githubusercontent.com')
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/new-file.txt')
        .reply(200, 'hello, world')
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/README.md')
        .reply(200, 'hello, world')
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/fail.md')
        .reply(404, 'missing')
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/no-modified.md')
        .reply(200, 'hello, world')
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/back-dated.md')
        .reply(200, 'hello, world')
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/no-modified-no-commits.md')
        .reply(200, 'hello, world')
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/src/fail/modified.htl')
        .reply(200, 'hello, world')
        .get('/owner/repo/ref/music.mp3')
        .reply(200, 'tralala!')
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/github-error.md')
        .replyWithError('broken');
      nock('https://api.github.com')
        .get('/repos/owner/repo/commits?page=1&per_page=1&sha=5edf98811d50b5b948f6f890f0c4367095490dbd&path=no-modified-no-commits.md')
        .reply(404)
        .get('/repos/owner/repo/commits?page=1&per_page=1&sha=ref&path=music.mp3')
        .reply(200, [{
          sha: '5beb72484d916d5682e59d78c3cc85e3e9d146b7',
          commit: {
            committer: {
              date: '2022-03-01T08:32:01Z',
            },
          },
        }])
        .get('/repos/owner/repo/commits?page=1&per_page=1&sha=5edf98811d50b5b948f6f890f0c4367095490dbd&path=no-modified.md')
        .reply(200, [{
          sha: '5beb72484d916d5682e59d78c3cc85e3e9d146b7',
          commit: {
            committer: {
              date: '2022-03-01T08:32:01Z',
            },
          },
        }])
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      ctx.attributes.config = {
        headers: {
          data: {
            '/**': [
              { key: 'access-control-allow-origin', value: '*' },
              { key: 'x-commit-id', value: '*' },
              { key: 'Content-Security-Policy', value: 'self;' },
              { key: 'content-security-policy-report-only', value: 'default-src \'self\'' },
              { key: 'content-encoding', value: 'gzip' },
            ],
          },
        },
      };
      codeBus
        .withFile('/owner/repo/ref/src/html.htl', 'foo')
        .withFile('/owner/repo/ref/src/fail/html.htl', 'foo')
        .withMeta('/owner/repo/ref/back-dated.md', {
          LastModified: '2022-03-01T08:32:01Z',
        });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      job.state.data.sha = '5edf98811d50b5b948f6f890f0c4367095490dbd';
      const codeSource = {
        owner: 'owner',
        repo: 'repo',
        base_url: 'https://api.github.com',
        raw_url: 'https://raw.githubusercontent.com',
        octokit: ctx.attributes.octokits['42'],
      };
      await job.sync(codeSource);
      removeLastModified(job.state.data.resources);
      job.state.data.resources.sort((a0, a1) => a0.resourcePath.localeCompare(a1.resourcePath));
      assert.deepStrictEqual(job.state.data, {
        baseRef: '',
        changes: [],
        codeOwner: 'owner',
        codePrefix: '/owner/repo/ref/',
        codeRef: 'ref',
        codeRepo: 'repo',
        githubRateLimit: {
          limit: 5000,
          remaining: 4999,
          reset: 1625731200,
        },
        installationId: 42,
        owner: 'owner',
        ref: 'ref',
        repo: 'repo',
        type: 'github',
        sha: '5edf98811d50b5b948f6f890f0c4367095490dbd',
        resources: [
          {
            contentLength: 12,
            contentType: 'text/markdown; charset=utf-8',
            resourcePath: '/back-dated.md',
            status: 200,
          },
          {
            contentType: 'text/markdown; charset=utf-8',
            error: 'error reading from github',
            resourcePath: '/fail.md',
            status: 404,
          },
          {
            contentType: 'text/markdown; charset=utf-8',
            error: 'error reading from github: broken',
            resourcePath: '/github-error.md',
            status: 500,
          },
          {
            contentLength: 8,
            contentType: undefined,
            resourcePath: '/music.mp3',
            status: 200,
          },
          {
            contentLength: 12,
            contentType: 'text/plain; charset=utf-8',
            resourcePath: '/new-file.txt',
            status: 200,
          },
          {
            contentLength: 12,
            contentType: 'text/markdown; charset=utf-8',
            resourcePath: '/no-modified-no-commits.md',
            status: 200,
          },
          {
            contentLength: 12,
            contentType: 'text/markdown; charset=utf-8',
            resourcePath: '/no-modified.md',
            status: 200,
          }, {
            contentLength: 12,
            contentType: 'text/markdown; charset=utf-8',
            resourcePath: '/README.md',
            status: 200,
          },
          {
            deleted: true,
            error: 'remove error',
            resourcePath: '/src/fail/html.htl',
            status: 500,
          },
          {
            contentLength: 12,
            contentType: 'application/octet-stream',
            error: 'uploading failed: put error',
            resourcePath: '/src/fail/modified.htl',
            status: 500,
          },
          {
            deleted: true,
            resourcePath: '/src/html.htl',
            status: 204,
          },
        ],
      });

      assert.deepStrictEqual(codeBus.added, [{
        body: 'hello, world',
        contentType: 'text/plain; charset=utf-8',
        filePath: '/owner/repo/ref/new-file.txt',
        meta: {
          'access-control-allow-origin': '*',
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': 'Tue, 04 May 2021 04:40:15 GMT',
        },
        compressed: true,
      }, {
        body: 'hello, world',
        contentType: 'text/markdown; charset=utf-8',
        filePath: '/owner/repo/ref/README.md',
        meta: {
          'access-control-allow-origin': '*',
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': 'Tue, 04 May 2021 04:40:15 GMT',
        },
        compressed: true,
      }, {
        body: 'hello, world',
        compressed: true,
        contentType: 'text/markdown; charset=utf-8',
        filePath: '/owner/repo/ref/no-modified-no-commits.md',
        meta: {
          'access-control-allow-origin': '*',
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
        },
      }, {
        body: 'hello, world',
        compressed: true,
        contentType: 'text/markdown; charset=utf-8',
        filePath: '/owner/repo/ref/no-modified.md',
        meta: {
          'access-control-allow-origin': '*',
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': 'Tue, 01 Mar 2022 08:32:01 GMT',
        },
      },
      {
        body: 'hello, world',
        compressed: true,
        contentType: 'text/markdown; charset=utf-8',
        filePath: '/owner/repo/ref/back-dated.md',
        meta: {
          'access-control-allow-origin': '*',
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': 'Tue, 01 Mar 2022 08:32:02 GMT',
        },
      }, {
        body: 'tralala!',
        compressed: false,
        contentType: undefined,
        filePath: '/owner/repo/ref/music.mp3',
        meta: {
          'access-control-allow-origin': '*',
          'x-commit-id': '5beb72484d916d5682e59d78c3cc85e3e9d146b7',
          'x-source-last-modified': 'Tue, 01 Mar 2022 08:32:01 GMT',
        },
      },
      {
        body: '5edf98811d50b5b948f6f890f0c4367095490dbd',
        compressed: false,
        contentType: 'text/plain',
        filePath: '/owner/repo/ref/.sha',
        meta: {
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': codeBus.added.at(-1).meta['x-source-last-modified'],
        },
      },
      ]);
      assert.deepEqual(codeBus.removed, [
        '/owner/repo/ref/src/html.htl',
      ]);
    });

    it('syncs events with rate limit error', async () => {
      nock('https://raw.githubusercontent.com')
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/new-file.txt')
        .reply(200, 'hello, world')
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/rate-error.md')
        .reply(429, '', {
          'x-ratelimit-remaining': 0,
        })
        // 2nd time ok
        .get('/owner/repo/5edf98811d50b5b948f6f890f0c4367095490dbd/rate-error.md')
        .reply(200, 'hello, world.');

      nock('https://api.github.com')
        .get('/repos/owner/repo/contents/rate-error.md?ref=5edf98811d50b5b948f6f890f0c4367095490dbd')
        .reply(429)
        .get('/rate_limit')
        .times(3)
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      ctx.attributes.config = {
        headers: {
          data: {
            '/**': [
              { key: 'access-control-allow-origin', value: '*' },
              { key: 'x-commit-id', value: '*' },
              { key: 'Content-Security-Policy', value: 'self;' },
              { key: 'content-security-policy-report-only', value: 'default-src \'self\'' },
              { key: 'content-encoding', value: 'gzip' },
            ],
          },
        },
      };
      codeBus
        .withFile('/owner/repo/ref/src/html.htl', 'foo')
        .withFile('/owner/repo/ref/src/fail/html.htl', 'foo')
        .withMeta('/owner/repo/ref/back-dated.md', {
          LastModified: '2022-03-01T08:32:01Z',
        });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-ratelimit.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      job.state.data.sha = '5edf98811d50b5b948f6f890f0c4367095490dbd';
      const codeSource = {
        owner: 'owner',
        repo: 'repo',
        base_url: 'https://api.github.com',
        raw_url: 'https://raw.githubusercontent.com',
        octokit: ctx.attributes.octokits['42'],
      };
      await assert.rejects(job.sync(codeSource), new RateLimitError('error reading content from github. (url=https://api.github.com/repos/owner/repo/contents/rate-error.md?ref=5edf98811d50b5b948f6f890f0c4367095490dbd, branch=undefined)'));

      // run a 2nd time which should retry the missed files
      await job.sync(codeSource);

      removeLastModified(job.state.data.resources);
      job.state.data.resources.sort((a0, a1) => a0.resourcePath.localeCompare(a1.resourcePath));
      assert.deepStrictEqual(job.state.data, {
        baseRef: '',
        changes: [],
        codeOwner: 'owner',
        codePrefix: '/owner/repo/ref/',
        codeRef: 'ref',
        codeRepo: 'repo',
        githubRateLimit: {
          limit: 5000,
          remaining: 4999,
          reset: 1625731200,
        },
        installationId: 42,
        owner: 'owner',
        ref: 'ref',
        repo: 'repo',
        type: 'github',
        sha: '5edf98811d50b5b948f6f890f0c4367095490dbd',
        resources: [
          {
            contentLength: 12,
            contentType: 'text/plain; charset=utf-8',
            resourcePath: '/new-file.txt',
            status: 200,
          },
          {
            contentLength: 13,
            contentType: 'text/markdown; charset=utf-8',
            resourcePath: '/rate-error.md',
            status: 200,
          },
        ],
      });

      assert.deepStrictEqual(codeBus.added, [{
        body: 'hello, world',
        contentType: 'text/plain; charset=utf-8',
        filePath: '/owner/repo/ref/new-file.txt',
        meta: {
          'access-control-allow-origin': '*',
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': 'Tue, 04 May 2021 04:40:15 GMT',
        },
        compressed: true,
      }, {
        body: 'hello, world.',
        compressed: true,
        contentType: 'text/markdown; charset=utf-8',
        filePath: '/owner/repo/ref/rate-error.md',
        meta: {
          'access-control-allow-origin': '*',
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': 'Tue, 04 May 2021 04:40:15 GMT',
        },
      },
      {
        body: '5edf98811d50b5b948f6f890f0c4367095490dbd',
        compressed: false,
        contentType: 'text/plain',
        filePath: '/owner/repo/ref/.sha',
        meta: {
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': codeBus.added[2].meta['x-source-last-modified'],
        },
      }]);
      assert.deepEqual(codeBus.removed, []);
    });

    it('syncs events (byogit)', async () => {
      nock('https://api.my-github.com/api/raw')
        .get('/code-owner/code-repo/5edf98811d50b5b948f6f890f0c4367095490dbd/new-file.txt')
        .reply(200, 'hello, world')
        .get('/code-owner/code-repo/5edf98811d50b5b948f6f890f0c4367095490dbd/README.md')
        .reply(200, 'hello, world')
        .get('/code-owner/code-repo/5edf98811d50b5b948f6f890f0c4367095490dbd/fail.md')
        .reply(502, 'timeout')
        .get('/code-owner/code-repo/5edf98811d50b5b948f6f890f0c4367095490dbd/back-dated.md')
        .reply(200, 'hello, world')
        .get('/code-owner/code-repo/5edf98811d50b5b948f6f890f0c4367095490dbd/no-modified.md')
        .reply(200, 'hello, world')
        .get('/code-owner/code-repo/5edf98811d50b5b948f6f890f0c4367095490dbd/no-modified-no-commits.md')
        .reply(200, 'hello, world')
        .get('/code-owner/code-repo/5edf98811d50b5b948f6f890f0c4367095490dbd/src/fail/modified.htl')
        .reply(200, 'hello, world')
        .get('/code-owner/code-repo/ref/music.mp3')
        .reply(200, 'tralala!')
        .get('/code-owner/code-repo/5edf98811d50b5b948f6f890f0c4367095490dbd/github-error.md')
        .replyWithError('broken');
      nock('https://api.my-github.com/api')
        .get('/repos/code-owner/code-repo/commits?page=1&per_page=1&sha=5edf98811d50b5b948f6f890f0c4367095490dbd&path=no-modified-no-commits.md')
        .reply(404)
        .get('/repos/code-owner/code-repo/commits?page=1&per_page=1&sha=ref&path=music.mp3')
        .reply(404)
        .get('/repos/code-owner/code-repo/commits?page=1&per_page=1&sha=5edf98811d50b5b948f6f890f0c4367095490dbd&path=no-modified.md')
        .reply(200, [{
          sha: '5beb72484d916d5682e59d78c3cc85e3e9d146b7',
          commit: {
            committer: {
              date: '2022-03-01T08:32:01Z',
            },
          },
        }])
        .get('/rate_limit')
        .twice()
        .reply(401);

      ctx.attributes.config = {
        ...SITE_CONFIG,
        code: {
          source: {
            type: 'github',
            url: 'https://api.my-github.com/api',
            raw_url: 'https://api.my-github.com/api/raw',
            owner: 'code-owner',
            repo: 'code-repo',
          },
          owner: 'owner',
          repo: 'repo',
        },
      };
      codeBus
        .withFile('/owner/repo/ref/src/html.htl', 'foo')
        .withFile('/owner/repo/ref/src/fail/html.htl', 'foo')
        .withMeta('/owner/repo/ref/back-dated.md', {
          LastModified: '2019-03-01T08:32:01Z',
        });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      const codeSource = await getCodeSource(ctx, events);
      await job.sync(codeSource);
      removeLastModified(job.state.data.resources);
      job.state.data.resources.sort((a0, a1) => a0.resourcePath.localeCompare(a1.resourcePath));
      assert.deepStrictEqual(job.state.data.resources, [
        {
          contentLength: 12,
          contentType: 'text/markdown; charset=utf-8',
          resourcePath: '/back-dated.md',
          status: 200,
        },
        {
          contentType: 'text/markdown; charset=utf-8',
          error: 'error reading from github',
          resourcePath: '/fail.md',
          status: 502,
        },
        {
          contentType: 'text/markdown; charset=utf-8',
          error: 'error reading from github: broken',
          resourcePath: '/github-error.md',
          status: 500,
        },
        {
          contentLength: 8,
          contentType: undefined,
          resourcePath: '/music.mp3',
          status: 200,
        },
        {
          contentLength: 12,
          contentType: 'text/plain; charset=utf-8',
          resourcePath: '/new-file.txt',
          status: 200,
        },
        {
          contentLength: 12,
          contentType: 'text/markdown; charset=utf-8',
          resourcePath: '/no-modified-no-commits.md',
          status: 200,
        },
        {
          contentLength: 12,
          contentType: 'text/markdown; charset=utf-8',
          resourcePath: '/no-modified.md',
          status: 200,
        },
        {
          contentLength: 12,
          contentType: 'text/markdown; charset=utf-8',
          resourcePath: '/README.md',
          status: 200,
        },
        {
          deleted: true,
          error: 'remove error',
          resourcePath: '/src/fail/html.htl',
          status: 500,
        },
        {
          contentLength: 12,
          contentType: 'application/octet-stream',
          error: 'uploading failed: put error',
          resourcePath: '/src/fail/modified.htl',
          status: 500,
        },
        {
          deleted: true,
          resourcePath: '/src/html.htl',
          status: 204,
        },
      ]);

      assert.deepStrictEqual(codeBus.added, [{
        body: 'hello, world',
        contentType: 'text/plain; charset=utf-8',
        filePath: '/owner/repo/ref/new-file.txt',
        meta: {
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': 'Tue, 04 May 2021 04:40:15 GMT',
        },
        compressed: true,
      }, {
        body: 'hello, world',
        contentType: 'text/markdown; charset=utf-8',
        filePath: '/owner/repo/ref/README.md',
        meta: {
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': 'Tue, 04 May 2021 04:40:15 GMT',
        },
        compressed: true,
      }, {
        body: 'hello, world',
        compressed: true,
        contentType: 'text/markdown; charset=utf-8',
        filePath: '/owner/repo/ref/no-modified-no-commits.md',
        meta: {
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
        },
      }, {
        body: 'hello, world',
        compressed: true,
        contentType: 'text/markdown; charset=utf-8',
        filePath: '/owner/repo/ref/no-modified.md',
        meta: {
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': 'Tue, 01 Mar 2022 08:32:01 GMT',
        },
      },
      {
        body: 'hello, world',
        compressed: true,
        contentType: 'text/markdown; charset=utf-8',
        filePath: '/owner/repo/ref/back-dated.md',
        meta: {
          'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
          'x-source-last-modified': 'Tue, 04 May 2021 04:40:15 GMT',
        },
      }, {
        body: 'tralala!',
        compressed: false,
        contentType: undefined,
        filePath: '/owner/repo/ref/music.mp3',
        meta: {
          'x-commit-id': '',
        },
      }]);
      assert.deepEqual(codeBus.removed, [
        '/owner/repo/ref/src/html.htl',
      ]);
    });

    it('getCodeSource() supports secret', async () => {
      ctx.attributes.config = {
        code: {
          source: {
            url: 'https://my.github.com',
            raw_url: 'https://my-raw.github.com',
            secret: 'my-secret',
          },
        },
      };
      const codeSource = await getCodeSource(ctx, {
        owner: 'owner',
        repo: 'repo',
        installationId: 'fake-installationid',
      });
      assert.deepStrictEqual(await codeSource.octokit.auth(), {
        token: 'my-secret',
        tokenType: 'oauth',
        type: 'token',
      });
      delete codeSource.octokit;
      assert.deepStrictEqual(codeSource, {
        base_url: 'https://my.github.com/',
        installationId: 'byogit',
        owner: 'owner',
        raw_url: 'https://my-raw.github.com',
        repo: 'repo',
        token: 'my-secret',
        url: 'https://my.github.com',
      });
    });

    it('getCodeSource() warns about missing secret', async () => {
      ctx.attributes.config = {
        code: {
          source: {
            url: 'https://my.github.com',
            raw_url: 'https://my-raw.github.com',
            secret: '',
            secretId: 'my-secret-id',
          },
        },
      };
      const codeSource = await getCodeSource(ctx, {
        owner: 'owner',
        repo: 'repo',
        installationId: 'fake-installationid',
      });
      assert.deepStrictEqual(await codeSource.octokit.auth(), {
        token: 'undefined',
        tokenType: 'oauth',
        type: 'token',
      });
      delete codeSource.octokit;
      assert.deepStrictEqual(codeSource, {
        base_url: 'https://my.github.com/',
        installationId: 'byogit',
        owner: 'owner',
        raw_url: 'https://my-raw.github.com',
        repo: 'repo',
        secretId: 'my-secret-id',
        url: 'https://my.github.com',
      });
    });

    it('deleting helix-query.yaml on main should remove query.yaml in content', async () => {
      nock('https://api.github.com')
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-delete-query.json'), 'utf-8'));
      codeBus.withFile('/owner/repo/main/helix-query.yaml', 'foo');
      contentBus.withFile('853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/.hlx.json', {
        'original-repository': 'owner/repo',
        'original-site': 'owner/repo',
      });

      const job = await createJob(ctx, events);
      const codeSource = {
        owner: 'owner',
        repo: 'repo',
        base_url: 'https://api.github.com',
        raw_url: 'https://raw.githubusercontent.com',
        octokit: ctx.attributes.octokits['42'],
      };
      await job.sync(codeSource);
      removeLastModified(job.state.data.resources);
      assert.deepStrictEqual(job.state.data.resources, [{
        deleted: true,
        resourcePath: '/helix-query.yaml',
        status: 204,
      }]);
      assert.deepEqual(codeBus.removed, ['/owner/repo/main/helix-query.yaml']);
      assert.deepEqual(contentBus.removed, ['853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/query.yaml']);
    });

    it('deleting helix-query.yaml on forked repo should not remove query.yaml in content', async () => {
      nock('https://api.github.com')
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-delete-query.json'), 'utf-8'));
      events.owner = 'other';
      codeBus.withFile('/other/repo/main/helix-query.yaml', 'foo');
      contentBus.withFile('foo-id/.hlx.json', {
        'original-repository': 'owner/repo',
      });

      const job = await createJob(ctx, events);
      const codeSource = {
        owner: 'owner',
        repo: 'repo',
        base_url: 'https://api.github.com',
        raw_url: 'https://raw.githubusercontent.com',
        octokit: ctx.attributes.octokits['42'],
      };
      await job.sync(codeSource);
      removeLastModified(job.state.data.resources);
      assert.deepStrictEqual(job.state.data.resources, [{
        deleted: true,
        resourcePath: '/helix-query.yaml',
        status: 204,
      }]);
      assert.deepEqual(codeBus.removed, ['/other/repo/main/helix-query.yaml']);
    });

    it('deleting helix-query.yaml with helix5 config should not remove query.yaml in content', async () => {
      nock('https://api.github.com')
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-delete-query.json'), 'utf-8'));
      codeBus.withFile('/owner/repo/main/helix-query.yaml', 'foo');
      contentBus.withFile('foo-id/.hlx.json', {
        'original-repository': 'owner/repo',
      });
      ctx.attributes.config = {};

      const job = await createJob(ctx, events);
      const codeSource = {
        owner: 'owner',
        repo: 'repo',
        base_url: 'https://api.github.com',
        raw_url: 'https://raw.githubusercontent.com',
        octokit: ctx.attributes.octokits['42'],
      };
      await job.sync(codeSource);
      removeLastModified(job.state.data.resources);
      assert.deepStrictEqual(job.state.data.resources, [{
        deleted: true,
        resourcePath: '/helix-query.yaml',
        status: 204,
      }]);
      assert.deepEqual(codeBus.removed, ['/owner/repo/main/helix-query.yaml']);
    });

    it('deleting helix-sitemap.yaml on main should remove sitemap.yaml in content', async () => {
      nock('https://api.github.com')
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-delete-sitemap.json'), 'utf-8'));
      codeBus.withFile('/owner/repo/main/helix-sitemap.yaml', 'foo');
      contentBus.withFile('foo-id/.hlx.json', {
        'original-repository': 'owner/repo',
      });

      const job = await createJob(ctx, events);
      const codeSource = {
        owner: 'owner',
        repo: 'repo',
        base_url: 'https://api.github.com',
        raw_url: 'https://raw.githubusercontent.com',
        octokit: ctx.attributes.octokits['42'],
      };
      await job.sync(codeSource);
      removeLastModified(job.state.data.resources);
      assert.deepStrictEqual(job.state.data.resources, [{
        deleted: true,
        resourcePath: '/helix-sitemap.yaml',
        status: 204,
      }]);
      assert.deepEqual(codeBus.removed, ['/owner/repo/main/helix-sitemap.yaml']);
      assert.deepEqual(contentBus.removed, ['foo-id/preview/.helix/sitemap.yaml']);
    });

    it('sync events ignored if job stopped', async () => {
      nock('https://api.github.com')
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      job.state.cancelled = true;
      const codeSource = {
        owner: 'owner',
        repo: 'repo',
        base_url: 'https://api.github.com',
        raw_url: 'https://raw.githubusercontent.com',
        octokit: ctx.attributes.octokits['42'],
      };
      await job.sync(codeSource);
      assert.deepStrictEqual(job.state.data.resources, []);
    });

    it('call storage for events (weird repo / branch)', async () => {
      nock('https://raw.githubusercontent.com')
        .get('/owner/TEST-42/tripod/test_@34/SUB/new-file.txt')
        .reply(200, 'hello, world')
        .get('/owner/TEST-42/5edf98811d50b5b948f6f890f0c4367095490dbd/README.md')
        .reply(200, 'hello, world')
        .get('/owner/TEST-42/5edf98811d50b5b948f6f890f0c4367095490dbd/fail.md')
        .reply(502, 'timeout');
      nock('https://api.github.com')
        .get('/rate_limit')
        .twice()
        .reply(200, { resources: { core: { limit: 5000, remaining: 4999, reset: 1625731200 } } });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-sb.json'), 'utf-8'));
      events.repo = 'TEST_42';
      codeBus
        .withFile('/owner/test-42/tripod-test-34-sub/src/html.htl', 'foo');

      const job = await createJob(ctx, events);
      job.state.data.sha = '5edf98811d50b5b948f6f890f0c4367095490dbd';
      const codeSource = {
        owner: 'owner',
        repo: 'TEST-42',
        base_url: 'https://api.github.com',
        raw_url: 'https://raw.githubusercontent.com',
        octokit: ctx.attributes.octokits['42'],
      };
      await job.sync(codeSource);
      assert.deepEqual(codeBus.added, [
        {
          body: 'hello, world',
          contentType: 'text/plain; charset=utf-8',
          filePath: '/owner/test-42/tripod-test-34-sub/new-file.txt',
          meta: {
            'x-commit-id': '',
            'x-source-last-modified': 'Tue, 04 May 2021 04:40:15 GMT',
          },
          compressed: true,
        },
        {
          body: 'hello, world',
          contentType: 'text/markdown; charset=utf-8',
          filePath: '/owner/test-42/tripod-test-34-sub/README.md',
          meta: {
            'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
            'x-source-last-modified': 'Tue, 04 May 2021 04:40:15 GMT',
          },
          compressed: true,
        },
        {
          body: '5edf98811d50b5b948f6f890f0c4367095490dbd',
          compressed: false,
          contentType: 'text/plain',
          filePath: '/owner/test-42/tripod-test-34-sub/.sha',
          meta: {
            'x-commit-id': '5edf98811d50b5b948f6f890f0c4367095490dbd',
            'x-source-last-modified': codeBus.added.at(-1).meta['x-source-last-modified'],
          },
        },
      ]);
      assert.deepEqual(codeBus.removed, [
        '/owner/test-42/tripod-test-34-sub/src/html.htl',
      ]);
    });

    it('sync handles branch deletion', async () => {
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-deleted.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      job.state.data.deleteTree = true;
      await job.sync();
      assert.deepStrictEqual(codeBus.rmdirs, ['/owner/repo/ref/']);
    });
  });

  describe('flush cache phase', () => {
    it('purges the resource paths', async () => {
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events.json'), 'utf-8'));
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/head.html',
        status: 200,
      }, {
        resourcePath: '/package.json',
        status: 204,
      }, {
        resourcePath: '/failed.json',
        status: 500,
      }, {
        resourcePath: '/not-modified.json',
        status: 304,
      }];
      await job.flushCache();
      const info = job.mockActions[0].args[1];
      delete info.changes;
      delete info.resources;
      assert.deepStrictEqual(info, {
        org: 'owner',
        owner: 'owner',
        ref: 'ref',
        site: 'repo',
        repo: 'repo',
      });
      assert.deepStrictEqual(job.mockActions[0].args[2], ['/head.html', '/package.json']);
    });

    it('purges the resource paths (unsupported character branch)', async () => {
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-sb.json'), 'utf-8'));
      events.codeRef = 'tripod-test-34-sub';
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/head.html',
        status: 200,
      }];
      await job.flushCache();
      const info = job.mockActions[0].args[1];
      delete info.changes;
      delete info.resources;
      assert.deepStrictEqual(info, {
        ref: 'tripod-test-34-sub',
        org: 'owner',
        owner: 'owner',
        site: 'repo',
        repo: 'repo',
      });
      assert.deepStrictEqual(job.mockActions[0].args[2], ['/head.html']);
    });

    it('purge handles branch deletion', async () => {
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-deleted.json'), 'utf-8'));
      const job = await createJob(ctx, events, true);
      job.state.data.deleteTree = true;
      await job.flushCache();
      const infos = job.mockActions[0].args[2];
      assert.deepStrictEqual(infos, [{
        key: 'ref--owner--repo',
      }, {
        key: 'ref--owner--repo_code',
      }]);
    });
  });

  describe('post process phase', () => {
    const INDEX_NEW = `
indices:
  default:
    target: /query-index.json
    properties:
      title:
        select: head > meta[property="og:title"]
        value: |
          attribute(el, 'content')
`;
    const SITEMAP_NEW = `
sitemaps:
  default:
    source: /query-index.json
    destination: /sitemap.xml
`;

    it('ignores if no config modified', async () => {
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      await job.postProcess();
    });

    it('ignores branch deletion', async () => {
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-branch-deleted.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      job.state.data.deleteTree = true;
      await job.postProcess();
    });

    it('update config if head.html is modified', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyConfigPurge('ref--repo--owner_head'))
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge('ref--repo--owner_head'));

      codeBus
        .withFile('/owner/repo/ref/head.html', '<head>');

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config-no-fstab.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      job.state.data.resources = [{
        resourcePath: '/head.html',
        status: 200,
      }];
      await job.postProcess();

      codeBus.added[0].body = JSON.parse(codeBus.added[0].body);
      assert.ok(codeBus.added[0].body.created);
      assert.deepEqual(codeBus.added, [
        {
          body: {
            helixVersion: 4,
            created: codeBus.added[0].body.created,
            content: {
              data: {
                '/': {
                  contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
                },
              },
            },
            fstab: {
              data: {
                folders: {},
                mountpoints: {
                  '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
                },
              },
            },
            head: {
              data: {
                html: '<head>',
              },
            },
            version: 2,
          },
          compressed: false,
          contentType: 'application/json',
          filePath: '/owner/repo/ref/helix-config.json',
          meta: {
            'x-contentbus-id': '/=853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
            'x-helix-version': '4',
            'x-created-date': codeBus.added[0].body.created,
          },
        },
      ]);
      assert.deepEqual(codeBus.removed, []);
      assert.deepEqual(ctx.attributes.mountConfig.toJSON(), {
        mountpoints: {
          '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
        },
        folders: {},
      });
    });

    it('update config if head.html is modified (aemsites)', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .times(2)
        .reply(200)
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(200);

      // from config merge
      nock('https://helix-content-bus.s3.us-east-1.amazonaws.com/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f')
        .get('/preview/.helix/config.json?x-id=GetObject')
        .reply(404)
        .get('/preview/.helix/headers.json?x-id=GetObject')
        .reply(404)
        .get('/preview/metadata.json?x-id=GetObject')
        .reply(404)
        .get('/live/metadata.json?x-id=GetObject')
        .reply(404);

      // from re-index
      nock('https://config.aem.page')
        .get('/main--repo--aemsites/config.json?scope=admin')
        .reply(404);

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config.json'), 'utf-8'));
      events.owner = 'aemsites';
      codeBus
        .withFile('/aemsites/repo/ref/head.html', '<head>')
        .withFile('/aemsites/repo/main/fstab.yaml', FSTAB);
      const job = await createJob(ctx, events);
      job.state.data.resources = [{
        resourcePath: '/fstab.yaml',
        status: 200,
      }, {
        resourcePath: '/head.html',
        status: 200,
      }];
      await job.postProcess();

      codeBus.added[0].body = JSON.parse(codeBus.added[0].body);
      assert.ok(codeBus.added[0].body.created);
      assert.deepEqual(codeBus.added, [
        {
          body: {
            content: {
              data: {
                '/': {
                  contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
                },
              },
            },
            fstab: {
              data: {
                folders: {},
                mountpoints: {
                  '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
                },
              },
            },
            created: codeBus.added[0].body.created,
            helixVersion: 4,
            version: 2,
          },
          compressed: false,
          contentType: 'application/json',
          filePath: '/aemsites/repo/main/helix-config.json',
          meta: {
            'x-contentbus-id': '/=853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
            'x-created-date': codeBus.added[0].body.created,
            'x-helix-version': '4',
          },
        },
      ]);
      assert.deepEqual(codeBus.removed, []);
      assert.deepEqual(ctx.attributes.mountConfig.toJSON(), {
        mountpoints: {
          '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
        },
        folders: {},
      });
    });

    it('new branch purges config with _head', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyConfigPurge('new-branch--repo--owner_head'))
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge('new-branch--repo--owner_head'));
      const events = {
        owner: 'owner',
        repo: 'repo',
        ref: 'new-branch',
        baseRef: 'main',
        changes: [
          {
            path: '*',
            type: 'added',
          },
        ],
      };

      const job = await createJob(ctx, events);
      job.state.data.treeSyncReason = true;
      await job.postProcess();
    });

    it('update config handles error', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyConfigPurge('fail--repo--owner_head'))
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge('fail--repo--owner_head'));

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config-no-fstab.json'), 'utf-8'));
      events.ref = 'fail';
      const job = await createJob(ctx, events);
      job.state.data.resources = [{
        resourcePath: '/head.html',
        status: 200,
      }];
      await job.postProcess();
      assert.deepEqual(codeBus.added, []);
      assert.deepEqual(codeBus.removed, []);
    });

    it('update config if head.html is modified (existing config)', async () => {
      nock.fstab();
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyConfigPurge('ref--repo--owner_head'))
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge('ref--repo--owner_head'));

      const configJson = {
        content: {
          data: {
            '/': {
              contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
            },
          },
        },
        head: {
          data: {
            html: '<head>',
          },
        },
        fstab: {
          data: {
            folders: {},
            mountpoints: {
              '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
            },
          },
        },
        version: 2,
      };
      codeBus
        .withFile('/owner/repo/main/fstab.yaml', FSTAB)
        .withFile('/owner/repo/ref/head.html', '<head>')
        .withFile('/owner/repo/ref/helix-config.json', JSON.stringify(configJson));

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config-no-fstab.json'), 'utf-8'));
      const job = await createJob(ctx, events);
      job.state.data.resources = [{
        resourcePath: '/head.html',
        status: 200,
      }];
      await job.postProcess();

      codeBus.added[0].body = JSON.parse(codeBus.added[0].body);
      assert.deepEqual(codeBus.added, [{
        body: configJson,
        compressed: false,
        contentType: 'application/json',
        filePath: '/owner/repo/ref/helix-config.json',
        meta: {
          'x-contentbus-id': '/=853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
        },
      },
      ]);
      assert.deepEqual(codeBus.removed, []);
      assert.deepEqual(ctx.attributes.mountConfig.toJSON(), {
        mountpoints: {
          '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
        },
        folders: {},
      });
    });

    it('handles fstab update (non main)', async () => {
      nock.fstab();
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyConfigPurge('branch-with-slash--repo--owner_head'))
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge('branch-with-slash--repo--owner_head'));

      codeBus.withFile('/owner/repo/main/fstab.yaml', FSTAB);
      codeBus.withFile('/owner/repo/branch-with-slash/fstab.yaml', FSTAB_NEW); // should not be used
      // head.html was deleted
      // storage.withFile('/owner/repo/ref/head.html', '<head>');

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config.json'), 'utf-8'));
      events.ref = 'branch_with/slash';
      events.codeRef = getCodeRef(events.ref);
      events.prefix = `/${events.owner}/${events.repo}/${events.codeRef}/`;

      const job = await createJob(ctx, events);
      job.state.data.resources = [{
        resourcePath: '/fstab.yaml',
        status: 200,
      }, {
        deleted: true,
        resourcePath: '/head.html',
        status: 202,
      }];
      await job.postProcess();

      codeBus.added[0].body = JSON.parse(codeBus.added[0].body);
      assert.ok(codeBus.added[0].body.created);
      assert.deepEqual(codeBus.added, [
        {
          body: {
            helixVersion: 4,
            created: codeBus.added[0].body.created,
            content: {
              data: {
                '/': {
                  contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
                },
              },
            },
            fstab: {
              data: {
                folders: {},
                mountpoints: {
                  '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
                },
              },
            },
            version: 2,
          },
          compressed: false,
          contentType: 'application/json',
          filePath: '/owner/repo/branch-with-slash/helix-config.json',
          meta: {
            'x-contentbus-id': '/=853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
            'x-helix-version': 4,
            'x-created-date': codeBus.added[0].body.created,
          },
        },
      ]);
      assert.deepEqual(codeBus.removed, []);
      assert.deepEqual(ctx.attributes.mountConfig.toJSON(), {
        mountpoints: {
          '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
        },
        folders: {},
      });
    });

    it('handles fstab update (non main, no head)', async () => {
      nock.fstab();
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyConfigPurge('ref--repo--owner_head'))
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge('ref--repo--owner_head'));

      codeBus.withFile('/owner/repo/main/fstab.yaml', FSTAB_FOLDER_MAPPED);
      codeBus.withFile('/owner/repo/ref/fstab.yaml', FSTAB_NEW); // should not be used
      // head.html was deleted
      // storage.withFile('/owner/repo/ref/head.html', '<head>');

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config-no-head.json'), 'utf-8'));
      events.ref = 'ref';
      const job = await createJob(ctx, events);
      job.state.data.resources = [{
        resourcePath: '/fstab.yaml',
        status: 200,
      }, {
        deleted: true,
        resourcePath: '/head.html',
        status: 202,
      }];
      await job.postProcess();

      codeBus.added[0].body = JSON.parse(codeBus.added[0].body);
      assert.ok(codeBus.added[0].body.created);
      assert.deepEqual(codeBus.added, [
        {
          body: {
            helixVersion: 4,
            created: codeBus.added[0].body.created,
            content: {
              data: {
                '/': {
                  contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
                },
              },
            },
            fstab: {
              data: {
                folders: {
                  '/products': '/products/default',
                },
                mountpoints: {
                  '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
                },
              },
            },
            version: 2,
          },
          compressed: false,
          contentType: 'application/json',
          filePath: '/owner/repo/ref/helix-config.json',
          meta: {
            'x-contentbus-id': '/=853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
            'x-helix-version': 4,
            'x-created-date': codeBus.added[0].body.created,
          },
        },
      ]);
      assert.deepEqual(codeBus.removed, []);
      assert.deepEqual(ctx.attributes.mountConfig.toJSON(), {
        mountpoints: {
          '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
        },
        folders: {},
      });
    });

    it('handles fstab update (main)', async () => {
      codeBus.withFile('/owner/repo/main/fstab.yaml', FSTAB_NEW);
      // head.html was deleted
      // storage.withFile('/owner/repo/ref/head.html', '<head>');
      codeBus.withFile('/owner/repo/main/helix-config.json', {
        version: 2,
        created: 'Thu, 06 Jun 2024 09:09:57 GMT',
        helixVersion: 5,
      });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config.json'), 'utf-8'));
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/fstab.yaml',
        status: 200,
      }];
      await job.postProcess();

      const performPurge = job.mockActions.splice(2, 1)[0];
      assert.strictEqual(performPurge.name, 'performPurge');
      assert.deepStrictEqual(performPurge.args[2], [
        {
          key: 'p_foo-id',
        },
        {
          key: 'foo-id',
        },
      ]);

      assert.deepStrictEqual(job.mockActions, [
        'deployFstab',
        'config-merge',
        'discoverReindex',
      ]);
      codeBus.added[0].body = JSON.parse(codeBus.added[0].body);
      assert.deepEqual(codeBus.added, [
        {
          body: {
            helixVersion: 5,
            created: 'Thu, 06 Jun 2024 09:09:57 GMT',
            content: {
              data: {
                '/': {
                  contentBusId: '55d2bd2eab1e751581f108d730b78b52d9c0e94ed9a68306d8b02373f66',
                },
              },
            },
            fstab: {
              data: {
                folders: {},
                mountpoints: {
                  '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-different',
                },
              },
            },
            version: 2,
          },
          compressed: false,
          contentType: 'application/json',
          filePath: '/owner/repo/main/helix-config.json',
          meta: {
            'x-contentbus-id': '/=55d2bd2eab1e751581f108d730b78b52d9c0e94ed9a68306d8b02373f66',
            'x-helix-version': '5',
            'x-created-date': 'Thu, 06 Jun 2024 09:09:57 GMT',
          },
        },
      ]);
      assert.deepEqual(codeBus.removed, []);
      assert.deepEqual(ctx.attributes.mountConfig.toJSON(), {
        mountpoints: {
          '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-different',
        },
        folders: {},
      });
    });

    it('handles fstab creation (main)', async () => {
      codeBus.withFile('/owner/repo/main/fstab.yaml', FSTAB_NEW);
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config.json'), 'utf-8'));
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/fstab.yaml',
        status: 200,
      }];
      await job.postProcess();

      const performPurge = job.mockActions.splice(2, 1)[0];
      assert.strictEqual(performPurge.name, 'performPurge');
      assert.deepStrictEqual(performPurge.args[2], [
        {
          key: 'p_foo-id',
        },
        {
          key: 'foo-id',
        },
      ]);

      assert.deepStrictEqual(job.mockActions, [
        'deployFstab',
        'config-merge',
        'discoverReindex',
      ]);
      codeBus.added[0].body = JSON.parse(codeBus.added[0].body);
      assert.deepEqual(codeBus.added, [
        {
          body: {
            helixVersion: 4,
            created: codeBus.added[0].body.created,
            content: {
              data: {
                '/': {
                  contentBusId: '55d2bd2eab1e751581f108d730b78b52d9c0e94ed9a68306d8b02373f66',
                },
              },
            },
            fstab: {
              data: {
                folders: {},
                mountpoints: {
                  '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-different',
                },
              },
            },
            version: 2,
          },
          compressed: false,
          contentType: 'application/json',
          filePath: '/owner/repo/main/helix-config.json',
          meta: {
            'x-contentbus-id': '/=55d2bd2eab1e751581f108d730b78b52d9c0e94ed9a68306d8b02373f66',
            'x-helix-version': '4',
            'x-created-date': codeBus.added[0].body.created,
          },
        },
      ]);
      assert.deepEqual(codeBus.removed, []);
      assert.deepEqual(ctx.attributes.mountConfig.toJSON(), {
        mountpoints: {
          '/': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-different',
        },
        folders: {},
      });
    });

    it('handles fstab delete (main)', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyConfigPurge('main--repo--owner_head'))
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge('main--repo--owner_head'));

      // storage.withFile('/owner/repo/ref/head.html', '<head>');
      codeBus.withFile('/owner/repo/main/helix-config.json', {
        version: 2,
        created: 'Thu, 06 Jun 2024 09:09:57 GMT',
        helixVersion: 5,
      });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config-fstab-deleted.json'), 'utf-8'));
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/fstab.yaml',
        deleted: true,
        status: 202,
      }];
      await job.postProcess();

      assert.deepStrictEqual(job.mockActions, []);
      assert.deepEqual(codeBus.added, []);
      assert.deepEqual(codeBus.removed, ['/owner/repo/main/helix-config.json']);
      assert.deepEqual(ctx.attributes.mountConfig, undefined);
    });

    it('handles rejected fstab update', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyConfigPurge())
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge());

      codeBus.withFile('/owner/repo/main/fstab.yaml', FSTAB_NEW);
      // head.html was deleted
      // storage.withFile('/owner/repo/ref/head.html', '<head>');
      codeBus.withFile('/owner/repo/main/helix-config.json', {
        version: 2,
        created: 'Thu, 06 Jun 2024 09:09:57 GMT',
        helixVersion: 5,
      });

      ctx.env.HLX_CONTENT_SOURCE_LOCK = JSON.stringify({
        'drive.google.com': [],
      });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config.json'), 'utf-8'));
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/fstab.yaml',
        status: 200,
      }];
      await job.postProcess();

      assert.strictEqual(job.mockActions.pop(), undefined);
      assert.deepStrictEqual(job.mockActions, []);
    });

    it('handles helix-query.yaml update (main)', async () => {
      codeBus
        .withFile('/owner/repo/main/fstab.yaml', FSTAB)
        .withFile('/owner/repo/main/helix-query.yaml', INDEX_NEW);
      contentBus.withFile('foo-id/.hlx.json', {
        'original-repository': 'owner/repo',
      });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-query.json'), 'utf-8'));
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/helix-query.yaml',
        status: 200,
      }];
      await job.postProcess();

      assert.strictEqual(contentBus.added.length, 1);
      assert.strictEqual(contentBus.added[0].filePath, 'foo-id/preview/.helix/query.yaml');
      assert.deepEqual(contentBus.added[0].body, INDEX_NEW);
    });

    it('handles helix-query.yaml remove (main)', async () => {
      codeBus.withFile('/owner/repo/main/fstab.yaml', FSTAB);
      contentBus.withFile('foo-id/.hlx.json', {
        'original-repository': 'owner/repo',
      });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-query.json'), 'utf-8'));
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/helix-query.yaml',
        status: 200,
        deleted: true,
      }];
      await job.postProcess();

      assert.strictEqual(contentBus.removed.length, 1);
      assert.strictEqual(contentBus.removed[0], 'foo-id/preview/.helix/query.yaml');
    });

    it('handles error while updating helix-query.yaml', async () => {
      codeBus
        .withFile('/owner/repo/main/fstab.yaml', FSTAB)
        .withFile('/owner/repo/main/helix-query.yaml', 'indices');
      contentBus.withFile('foo-id/.hlx.json', {
        'original-repository': 'owner/repo',
      });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-query.json'), 'utf-8'));
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/helix-query.yaml',
        status: 200,
      }];
      await job.postProcess();

      assert.strictEqual(contentBus.added.length, 0);
    });

    it('handles helix-sitemap.yaml update (main)', async () => {
      codeBus
        .withFile('/owner/repo/main/fstab.yaml', FSTAB)
        .withFile('/owner/repo/main/helix-sitemap.yaml', SITEMAP_NEW);
      contentBus.withFile('foo-id/.hlx.json', {
        'original-repository': 'owner/repo',
      });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-sitemap.json'), 'utf-8'));
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/helix-sitemap.yaml',
        status: 200,
      }];
      await job.postProcess();

      assert.strictEqual(contentBus.added.length, 1);
      assert.strictEqual(contentBus.added[0].filePath, 'foo-id/preview/.helix/sitemap.yaml');
      assert.deepEqual(contentBus.added[0].body, SITEMAP_NEW);
    });

    it('ignored helix-sitemap.yaml update (forked)', async () => {
      codeBus.withFile('/other/repo/main/helix-sitemap.yaml', SITEMAP_NEW);
      contentBus.withFile('foo-id/.hlx.json', {
        'original-repository': 'owner/repo',
      });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-sitemap.json'), 'utf-8'));
      events.owner = 'other';

      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/helix-sitemap.yaml',
        status: 200,
      }];
      await job.postProcess();

      assert.strictEqual(contentBus.added.length, 0);
    });

    it('ignores helix-sitemap.yaml update (non-main)', async () => {
      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-sitemap.json'), 'utf-8'));
      events.ref = 'other';

      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/helix-sitemap.yaml',
        status: 200,
      }];
      await job.postProcess();

      assert.strictEqual(contentBus.added.length, 0);
    });

    it('ignores helix-sitemap.yaml update (no fstab.yaml)', async () => {
      codeBus.withFile('/owner/repo/main/helix-sitemap.yaml', SITEMAP_NEW);
      contentBus.withFile('foo-id/.hlx.json', {
        'original-repository': 'owner/repo',
      });

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-sitemap.json'), 'utf-8'));

      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/helix-sitemap.yaml',
        status: 200,
      }];
      await job.postProcess();

      assert.strictEqual(contentBus.added.length, 0);
    });

    it('purge config if sidekick.json is modified (helix5)', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyPurge('u9DQngmJ6BZT5Mdb'))
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge());

      codeBus
        .withFile('owner/repo/main/fstab.yaml', FSTAB)
        .withFile('owner/repo/main/tools/sidekick/config.json', '{ "plugins": []}');

      const oldConfig = JSON.parse(JSON.stringify(SITE_CONFIG));
      delete oldConfig.headers;
      delete oldConfig.access;
      delete oldConfig.cdn;
      configBus
        .withFile('/orgs/owner/sites/repo.json', JSON.stringify(oldConfig));

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config-sidekick.json'), 'utf-8'));
      await applyConfig(ctx, { }, SITE_CONFIG);
      const job = await createJob(ctx, events, true);
      job.state.data.resources = [{
        resourcePath: '/tools/sidekick/config.json',
        status: 200,
      }];
      await job.postProcess();
    });

    it('purge config if robots.txt is modified (helix5)', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyConfigPurge())
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge());

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config-robots.json'), 'utf-8'));
      ctx.attributes.config = {};
      const job = await createJob(ctx, events);
      job.state.data.resources = [{
        resourcePath: '/robots.txt',
        status: 200,
      }];
      await job.postProcess();
    });

    it('purge config if head.html is modified (helix5)', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(replyConfigPurge('main--repo--owner_head'))
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(replyConfigPurge('main--repo--owner_head'));

      const events = JSON.parse(await fs.readFile(path.resolve(__testdir, 'code', 'fixtures', 'events-with-config-head.json'), 'utf-8'));
      await applyConfig(ctx, { }, SITE_CONFIG);
      const job = await createJob(ctx, events);
      job.state.data.resources = [{
        resourcePath: '/head.html',
        status: 200,
      }];
      await job.postProcess();
    });
  });
});
