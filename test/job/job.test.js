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
/* eslint-disable max-classes-per-file */
/* eslint-env mocha */
import assert from 'assert';
import crypto from 'crypto';
import sinon from 'sinon';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { decryptToken, encryptToken, Job } from '../../src/job/job.js';
import { JobStorage } from '../../src/job/storage.js';
import { StatusCodeError } from '../../src/support/StatusCodeError.js';
import { createContext, createInfo, Nock } from '../utils.js';

describe('Job Tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  async function testCreateJob(version, jobs = [], numCtrlJobs = 0, payload = {}, opts = {
    roles: ['author'],
  }) {
    let jobName;
    let jobState;
    let numHistoryJobs = 0;

    // Calculate number of active jobs from the jobs array (non-stopped jobs)
    const activeJobs = jobs.filter((j) => j.state !== 'stopped');
    const completedJobs = jobs.filter((job) => job.state === 'stopped');
    const incomingFiles = activeJobs.map((j) => ({
      Key: `test/incoming/${j.name}.json`,
      LastModified: new Date(j.time),
      Size: 100,
    }));

    nock.content('853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f')
      .listObjects('/preview/.helix/admin-jobs/test/incoming/', incomingFiles)
      .getObject('/preview/.helix/admin-jobs/test.json')
      .reply(200, {
        topic: 'test',
        jobs: completedJobs,
      })
      .putObject('/preview/.helix/admin-jobs/test.json')
      .optionally()
      .reply((_, body) => {
        numHistoryJobs = body.jobs.length;
        return [200];
      })
      // PUT the new job state to incoming directory
      .put(/\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .reply((uri, body) => {
        jobState = body;
        // Extract job name from URI
        const match = uri.match(/job-([^?]+)\.json/);
        if (match) {
          jobName = `job-${match[1]}`;
        }
        return [200];
      });

    if (version.startsWith('ci') && version !== 'ci') {
      nock('https://lambda.us-east-1.amazonaws.com')
        .post('/2015-03-31/functions/helix-api-service/invocations')
        .reply((_, requestBody) => {
          const { Records } = JSON.parse(requestBody);
          const { path, roles } = JSON.parse(Records[0].body);
          assert.deepStrictEqual(roles, ['author']);
          assert.ok(path.startsWith('/org/sites/site/jobs/test/job-'));
          return [200];
        });
    } else {
      nock('https://sqs.us-east-1.amazonaws.com')
        .post('/', (body) => {
          const { QueueUrl = '' } = body;
          if (version === 'ci') {
            return QueueUrl.endsWith('/helix-api-service-jobs-ci.fifo');
          }
          return QueueUrl.endsWith('/helix-api-service-jobs.fifo');
        })
        .reply((_, body) => {
          // eslint-disable-next-line no-param-reassign
          body = JSON.parse(body);
          const md5 = crypto.createHash('md5').update(body.MessageBody, 'utf-8').digest().toString('hex');
          // eslint-disable-next-line no-param-reassign
          body.MessageBody = JSON.parse(body.MessageBody);
          assert.deepStrictEqual(
            body,
            {
              MessageBody: {
                body: '',
                headers: {
                  'x-invocation-id': 'invocation-id',
                },
                method: 'RUN',
                path: `/org/sites/site/jobs/test/${jobName}`,
                user: 'admin@example.com',
                roles: [
                  'author',
                ],
              },
              MessageGroupId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/test',
              QueueUrl: `https://sqs.us-east-1.amazonaws.com/account-id/helix-api-service-jobs${version === 'ci' ? '-ci' : ''}.fifo`,
            },
          );
          return [200, JSON.stringify({
            MessageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
            MD5OfMessageBody: md5,
          })];
        });
    }

    const ctx = createContext('/org/sites/site/jobs/test', {
      data: payload,
    });
    ctx.attributes.authInfo = AuthInfo.Admin()
      .withAuthToken('foo-token')
      .withProfile({ userId: 'admin', email: 'admin@example.com' });
    ctx.func.version = version;
    const result = await Job.create(ctx, createInfo('/org/sites/site/jobs/test'), 'test', opts);

    assert.strictEqual(result.status, 202);

    const data = await result.json();
    assert.deepStrictEqual(data.job, jobState);

    assert.strictEqual(numCtrlJobs, numHistoryJobs);
    delete data.job.createTime;
    if (version.startsWith('ci') && version !== 'ci') {
      assert.deepStrictEqual(data, {
        job: {
          data: {},
          name: jobName,
          state: 'created',
          topic: 'test',
          user: 'admin@example.com',
        },
        links: {
          list: 'https://api.aem.live/org/sites/site/jobs/test',
          self: `https://api.aem.live/org/sites/site/jobs/test/${jobName}`,
        },
      });
    } else {
      assert.deepStrictEqual(data, {
        job: {
          data: {},
          name: jobName,
          state: 'created',
          topic: 'test',
          user: 'admin@example.com',
        },
        messageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
        links: {
          list: 'https://api.aem.live/org/sites/site/jobs/test',
          self: `https://api.aem.live/org/sites/site/jobs/test/${jobName}`,
        },
      });
    }
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
    });
  }
  it('Creates a new job', async () => {
    await testCreateJob('v12');
  });

  it('Creates a new job (force async)', async () => {
    await testCreateJob('v12', [], 0, {
      forceAsync: true,
    }, {
      roles: ['author'],
      transient: true,
    });
  });

  it('Creates a new job and deletes old ones', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .post('/?delete=')
      .reply((uri, body) => {
        assert.strictEqual(body, '<?xml version="1.0" encoding="UTF-8"?>'
          + '<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
          + '<Object><Key>853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/old1.json</Key></Object>'
          + '<Object><Key>853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/old2.json</Key></Object>'
          + '</Delete>');
        return [200, '<?xml version="1.0" encoding="UTF-8"?><DeleteResult><Deleted><Key>/foo</Key></Deleted></DeleteResult>'];
      });
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    await testCreateJob('v12', [{
      name: 'old1',
      time: '2024-01-01T00:00:00Z',
      state: 'stopped',
    }, {
      name: 'old2',
      time: '2024-01-02T00:00:00Z',
      state: 'stopped',
    }, {
      name: 'not-so-old',
      time: twoDaysAgo.toISOString(),
      state: 'stopped',
    }], 1);
  });

  it('Creates a new job (ci)', async () => {
    await testCreateJob('ci');
  });

  it('Creates a new job (ci123)', async () => {
    await testCreateJob('ci123');
  });

  it('Creates a new job (forceSync)', async () => {
    const ctx = createContext('/org/sites/site/jobs/test', {
      data: {
        forceSync: true,
      },
    });
    ctx.attributes.authInfo = AuthInfo.Admin().withAuthToken('foo-token');
    const result = await Job.create(ctx, createInfo('/org/sites/site/jobs/test'), 'test', {
      roles: ['author'],
    });

    assert.strictEqual(result.status, 200);

    const data = await result.json();
    delete data.job.createTime;
    delete data.job.startTime;
    delete data.job.stopTime;
    delete data.job.name;
    assert.deepStrictEqual(data.job, {
      data: {},
      invocationId: 'invocation',
      state: 'stopped',
      topic: 'test',
    });
  });

  it('Creates a new job and includes x-content-source-authorization header', async () => {
    const jobs = [];
    let jobName;
    nock.content('853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f')
      .listObjects('/preview/.helix/admin-jobs/test/incoming/', [])
      .getObject('/preview/.helix/admin-jobs/test.json')
      .reply(200, {
        topic: 'test',
        jobs,
      })
      // PUT the new job state to incoming directory
      .put(/\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .reply((uri) => {
        const match = uri.match(/job-([^?]+)\.json/);
        if (match) {
          jobName = `job-${match[1]}`;
        }
        return [200];
      });

    const ctx = createContext('/org/sites/site/jobs/test', {
      env: {
        CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'fake-secret',
      },
    });
    const info = createInfo('/org/sites/site/jobs/test', {
      'x-content-source-authorization': 'foo-token',
    });
    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/', (body) => {
        const { QueueUrl = '' } = body;
        return QueueUrl.endsWith('/helix-api-service-jobs.fifo');
      })
      .reply((_, body) => {
        // eslint-disable-next-line no-param-reassign
        body = JSON.parse(body);
        const md5 = crypto.createHash('md5').update(body.MessageBody, 'utf-8').digest().toString('hex');
        // eslint-disable-next-line no-param-reassign
        body.MessageBody = JSON.parse(body.MessageBody);
        const auth = body.MessageBody.headers['x-content-source-authorization-encrypted'];
        assert.strictEqual(decryptToken(ctx, auth), 'foo-token');
        assert.deepStrictEqual(
          body,
          {
            MessageBody: {
              body: '',
              headers: {
                'x-invocation-id': 'invocation-id',
                'x-content-source-authorization-encrypted': auth,
              },
              method: 'RUN',
              path: `/org/sites/site/jobs/test/${jobName}`,
              roles: [
                'author',
              ],
            },
            MessageGroupId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/test',
            QueueUrl: 'https://sqs.us-east-1.amazonaws.com/account-id/helix-api-service-jobs.fifo',
          },
        );
        return [200, JSON.stringify({
          MessageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
          MD5OfMessageBody: md5,
        })];
      });

    ctx.attributes.authInfo = AuthInfo.Admin().withAuthToken('foo-token');
    const result = await Job.create(ctx, info, 'test', {
      roles: ['author'],
    });

    assert.strictEqual(result.status, 202);

    const data = await result.json();
    delete data.job.createTime;
    delete data.job.startTime;
    delete data.job.stopTime;
    delete data.job.name;
    assert.deepStrictEqual(data.job, {
      data: {},
      state: 'created',
      topic: 'test',
    });
  });

  it('Creates job, uses user from context', async () => {
    const ctx = createContext({
      runtime: {
        accountId: '1234',
      },
    });
    ctx.attributes.authInfo = AuthInfo.Admin()
      .withAuthToken('foo-token')
      .withProfile({ userId: 'admin', email: 'admin@example.com' });
    const result = await Job.create(ctx, createInfo(), 'test', {
      roles: ['author'],
      transient: true,
    });

    assert.strictEqual(result.status, 200);

    const data = await result.json();
    delete data.job.createTime;
    delete data.job.startTime;
    delete data.job.stopTime;
    delete data.job.name;
    assert.deepStrictEqual(data.job, {
      data: {},
      invocationId: 'invocation',
      state: 'stopped',
      topic: 'test',
      user: 'admin@example.com',
    });
  });

  it('Create job, user in opts overrides context', async () => {
    const ctx = createContext({
      runtime: {
        accountId: '1234',
      },
    });
    ctx.attributes.authInfo = AuthInfo.Admin()
      .withAuthToken('foo-token')
      .withProfile({ userId: 'admin', email: 'admin@example.com' });
    const result = await Job.create(ctx, createInfo(), 'test', {
      roles: ['author'],
      transient: true,
      user: 'override@example.com',
    });

    assert.strictEqual(result.status, 200);

    const data = await result.json();
    delete data.job.createTime;
    delete data.job.startTime;
    delete data.job.stopTime;
    delete data.job.name;
    assert.deepStrictEqual(data.job, {
      data: {},
      invocationId: 'invocation',
      state: 'stopped',
      topic: 'test',
      user: 'override@example.com',
    });
  });

  it('Creates a new job for the first time', async () => {
    nock.listObjects('helix-content-bus', '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/', []);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .reply(404)
      // PUT the new job state to incoming directory
      .put(/\/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .reply(200);
    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply((_, body) => {
        // eslint-disable-next-line no-param-reassign
        const md5 = crypto.createHash('md5').update(JSON.parse(body).MessageBody, 'utf-8').digest().toString('hex');
        return [200, JSON.stringify({
          MessageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
          MD5OfMessageBody: md5,
        })];
      });

    const result = await Job.create(createContext(), createInfo(), 'test');
    assert.strictEqual(result.status, 202);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
    });
  });

  it('Create invokes directly in development server', async () => {
    process.env.HLX_DEV_SERVER_HOST = 'http://localhost:3000';
    nock.listObjects('helix-content-bus', '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/', []);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .twice()
      .reply(404)
      // Check for stop file in incoming directory
      .get(/\/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)-stop\.json/)
      .reply(404)
      // PUT the job state to incoming directory multiple times during execution
      .put(/\/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .times(3)
      .reply(200)
      // Move operation: GET from incoming (for move), PUT to completed, DELETE from incoming
      .get(/\/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .reply(200, '{}')
      .put(/\/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f\/preview\/\.helix\/admin-jobs\/test\/job-(.*)\.json/)
      .reply(200)
      .delete(/\/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .reply(200)
      // Update history file with completed job
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=PutObject')
      .reply(200)
      // Delete stop file from incoming
      .delete(/\/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)-stop\.json/)
      .reply(404)
      // Load state after completion
      .get(/\/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .reply(404)
      .get(/\/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f\/preview\/\.helix\/admin-jobs\/test\/job-(.*)\.json/)
      .reply(200, '{}');

    let testJob;

    class MockJob extends Job {
      constructor(...props) {
        super(...props);
        testJob = this;
      }

      async run() {
        this.runCalled = true;
      }
    }

    const result = await Job.create(createContext(), createInfo(), 'test', {
      jobClass: MockJob,
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(testJob.runCalled, true);
  });

  it('Rejects a 5th job for the same topic (maxQueued = 4)', async () => {
    nock.listObjects('helix-content-bus', '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/', [
      { Key: 'job-1.json' },
      { Key: 'job-2.json' },
      { Key: 'job-3.json' },
      { Key: 'job-4.json' },
    ]);
    await assert.rejects(Job.create(createContext(), createInfo(), 'test', { maxQueued: 4 }), new StatusCodeError('max 4 test jobs already queued.', 409));
  });

  const createJob = async (ctx, info, topic, name) => {
    const storage = await JobStorage.create(ctx, info, Job);
    return new Job(ctx, info, topic, name, storage);
  };

  it('stop puts a stop-file', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-123-stop.json?x-id=GetObject')
      .twice()
      .reply(404)
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-123-stop.json?x-id=GetObject')
      .reply(200)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-123-stop.json?x-id=PutObject')
      .reply(200);

    const job = await createJob(createContext(), createInfo(), 'test', 'job-123');
    job.state = {
      state: 'running',
    };
    assert.strictEqual(await job.checkStopped(), false);
    await job.stop();
    assert.strictEqual(await job.checkStopped(true), true);
    assert.strictEqual(await job.checkStopped(), true);
  });

  it('stop ignored if stop-file already present', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/undefined-stop.json?x-id=GetObject')
      .reply(200);

    const job = await createJob(createContext(), createInfo(), 'test');
    job.state = {
      state: 'running',
    };
    await job.stop();
  });

  it('stop ignored if already stopped', async () => {
    const job = await createJob(createContext(), createInfo(), 'test');
    job.state = {
      state: 'stopped',
    };
    await job.stop();
  });

  it('stop transiently stops', async () => {
    const job = (await createJob(createContext(), createInfo(), 'test'))
      .withTransient(true);
    job.state = {};
    await job.stop();
    assert.strictEqual(job.state.state, 'stopped');
  });

  it('checkStopped returns false', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/undefined-stop.json?x-id=GetObject')
      .reply(404);

    const job = await createJob(createContext(), createInfo(), 'test');
    job.state = {
      state: 'stopped',
    };
    assert.strictEqual(await job.checkStopped(), false);
  });

  it('checkStopped returns true', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/undefined-stop.json?x-id=GetObject')
      .reply(200);

    const job = await createJob(createContext(), createInfo(), 'test');
    job.state = {
      state: 'stopped',
    };
    assert.strictEqual(await job.checkStopped(), true);
    assert.strictEqual(job.state.cancelled, true);
  });

  const createMockJob = async (ctx, info, topic, name, JobClass) => {
    const storage = await JobStorage.create(ctx, info, JobClass);
    return new JobClass(ctx, info, topic, name, storage);
  };

  it('invoke calls run', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=GetObject')
      .reply(404)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'running');
        return [200];
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'running');
        return [200];
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'stopped');
        return [200];
      })
      // move
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=GetObject')
      .reply(200)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/job-42.json?x-id=PutObject')
      .reply(200)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=DeleteObject')
      .reply(200)

      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        jobs: [{ name: 'job-42' }],
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=PutObject')
      .reply(200)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=DeleteObject')
      .reply(200);

    class MockJob extends Job {
      async run() {
        await super.run(); // to make coverage happy
        await this.writeStateLazy(); // this should trigger no save, since it's within 3 seconds
        this.lastSaveTime = Date.now() - 10000; // simulate stale log
        await this.writeStateLazy(); // this should trigger no save, since it's within 3 seconds
        this.runCalled = true;
        this.state.cancelled = true;
      }
    }

    const ctx = createContext();
    const info = createInfo();
    // also test decoding the x-content-source-authorization here
    info.headers['x-content-source-authorization-encrypted'] = encryptToken(ctx, 'foo-token');

    const job = await createMockJob(ctx, info, 'test', 'job-42', MockJob);
    job.state = {
      state: 'started',
    };

    await job.invoke();
    assert.strictEqual(job.runCalled, true);
    delete job.state.startTime;
    delete job.state.stopTime;
    assert.deepStrictEqual(job.state, {
      cancelled: true,
      state: 'stopped',
      invocationId: 'invocation',
    });
    assert.strictEqual(job.info.headers['x-content-source-authorization'], 'foo-token');
  });

  it('invoke completes with audit entry containing job topic', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/my-job-name-stop.json?x-id=GetObject')
      .reply(404)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/my-job-name.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'running');
        return [200];
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/my-job-name.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'running');
        return [200];
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/my-job-name.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'stopped');
        return [200];
      })
      // move
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/my-job-name.json?x-id=GetObject')
      .reply(200)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/my-job-name.json?x-id=PutObject')
      .reply(200)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/my-job-name.json?x-id=DeleteObject')
      .reply(200)

      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        jobs: [{ name: 'my-job-name' }],
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=PutObject')
      .reply(200)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/my-job-name-stop.json?x-id=DeleteObject')
      .reply(200);

    class MockJob extends Job {
      async run() {
        await super.run(); // to make coverage happy
        // add a single request
        const info = {
          ...this.info,
          route: 'live',
          method: 'DELETE',
          path: '/path',
          resourcePath: '/path.md',
          ext: '.md',
        };
        await this.audit(this.ctx, info, { res: new Response(), start: 0, stop: 1 });
        await this.writeStateLazy(); // this should trigger no save, since it's within 3 seconds
        this.lastSaveTime = Date.now() - 10000; // simulate stale log
        await this.writeStateLazy(); // this should trigger no save, since it's within 3 seconds
        this.runCalled = true;
        this.state.cancelled = true;
      }
    }

    const job = await createMockJob(
      createContext(),
      createInfo(),
      'test',
      'my-job-name',
      MockJob,
    );
    job.state = {
      state: 'started',
    };
    await job.invoke();
    assert.strictEqual(job.runCalled, true);
    delete job.state.startTime;
    delete job.state.stopTime;
    assert.deepStrictEqual(job.state, {
      cancelled: true,
      state: 'stopped',
      invocationId: 'invocation',
    });

    const audits = nock.getAudits();
    const { updates } = JSON.parse(audits[0].MessageBody);
    assert.deepStrictEqual(updates[0], {
      org: 'org',
      site: 'site',
      owner: 'owner',
      repo: 'repo',
      ref: 'ref',
      result: {
        timestamp: 0,
        contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
        duration: 1,
        status: 200,
        method: 'DELETE',
        route: 'live',
        path: '/path',
      },
    });
    delete updates[1].result.duration;
    delete updates[1].result.timestamp;
    assert.deepStrictEqual(updates[1], {
      org: 'org',
      site: 'site',
      owner: 'owner',
      repo: 'repo',
      ref: 'ref',
      result: {
        job: 'test/my-job-name',
        contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
        status: 200,
        method: 'POST',
        path: '/',
      },
    });
  });

  it('invoke can resume job ', async () => {
    nock.audit();

    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=GetObject')
      .reply(404)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'running');
        return [200];
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'running');
        return [200];
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'stopped');
        return [200];
      })
      // move
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=GetObject')
      .reply(200)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/job-42.json?x-id=PutObject')
      .reply(200)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=DeleteObject')
      .reply(200)

      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        jobs: [{ name: 'job-42' }],
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=PutObject')
      .reply(200)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=DeleteObject')
      .reply(200);

    class MockJob extends Job {
      async run() {
        await super.run(); // to make coverage happy
        await this.writeStateLazy(); // this should trigger no save, since it's within 3 seconds
        this.lastSaveTime = Date.now() - 10000; // simulate stale log
        await this.writeStateLazy(); // this should trigger no save, since it's within 3 seconds
        this.runCalled = true;
        this.state.cancelled = true;
      }
    }

    const job = await createMockJob(createContext(), createInfo(), 'test', 'job-42', MockJob);
    job.state = {
      state: 'started',
      invocationId: 'previous-invocation',
    };
    await job.invoke();
    assert.strictEqual(job.runCalled, true);
    delete job.state.startTime;
    delete job.state.stopTime;
    assert.deepStrictEqual(job.state, {
      cancelled: true,
      state: 'stopped',
      invocationId: [
        'previous-invocation',
        'invocation',
      ],
    });
  });

  it('invoke stopped job does not proceed', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=GetObject')
      .reply(200);

    class MockJob extends Job {
      async run() {
        this.runCalled = true;
      }
    }

    const job = await createMockJob(createContext(), createInfo(), 'test', 'job-42', MockJob);
    job.state = {
      state: 'stopped',
    };
    await job.invoke();
    assert.strictEqual(job.runCalled, undefined);
    delete job.state.startTime;
    delete job.state.stopTime;
    assert.deepStrictEqual(job.state, {
      cancelled: true,
      state: 'stopped',
    });
  });

  it('handles errors during run', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=GetObject')
      .reply(404)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'running');
        return [200];
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'stopped');
        return [200];
      })
      // move - test failing move
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=GetObject')
      .reply(404)

      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        jobs: [{ name: 'job-42' }],
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=PutObject')
      .reply(200)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=DeleteObject')
      .reply(200);

    class MockJob extends Job {
      // eslint-disable-next-line class-methods-use-this
      async run() {
        throw new Error('boom!');
      }
    }

    const job = await createMockJob(createContext(), createInfo(), 'test', 'job-42', MockJob);
    job.state = {
      state: 'started',
    };
    await job.invoke();
    delete job.state.startTime;
    delete job.state.stopTime;
    assert.deepStrictEqual(job.state, {
      error: 'boom!',
      state: 'stopped',
      invocationId: 'invocation',
    });
  });

  it('handles errors during complete', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=GetObject')
      .reply(404)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'running');
        return [200];
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'stopped');
        return [200];
      })
      // move - test failing move
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=GetObject')
      .reply(404)

      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        jobs: [{ name: 'job-42' }],
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=PutObject')
      .reply(401)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=DeleteObject')
      .reply(200);

    class MockJob extends Job {
    }

    const job = await createMockJob(createContext(), createInfo(), 'test', 'job-42', MockJob);
    job.state = {
      state: 'started',
    };
    await job.invoke();
    delete job.state.startTime;
    delete job.state.stopTime;
    assert.deepStrictEqual(job.state, {
      state: 'stopped',
      invocationId: 'invocation',
    });
  });

  it('handles single failures during run', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=GetObject')
      .reply(404)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'running');
        return [200];
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=PutObject')
      .reply((_, body) => {
        assert.strictEqual(body.state, 'stopped');
        return [200];
      })

      // move
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=GetObject')
      .reply(200)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/job-42.json?x-id=PutObject')
      .reply(200)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42.json?x-id=DeleteObject')
      .reply(200)

      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        jobs: [{ name: 'job-42' }],
      })
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=PutObject')
      .reply(200)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-42-stop.json?x-id=DeleteObject')
      .reply(200);

    class MockJob extends Job {
      // eslint-disable-next-line class-methods-use-this
      async run() {
        await this.trackProgress({
          processed: 0,
          failed: 1,
          total: 1,
        });
      }
    }

    const job = await createMockJob(createContext(), createInfo(), 'test', 'job-42', MockJob);
    job.state = {
      state: 'started',
    };
    await job.invoke();
    delete job.state.startTime;
    delete job.state.stopTime;
    assert.deepStrictEqual(job.state, {
      progress: {
        processed: 0,
        failed: 1,
        total: 1,
      },
      state: 'stopped',
      invocationId: 'invocation',
    });
  });

  it('lists pending and current jobs', async () => {
    nock.listObjects('helix-content-bus', '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/', [
      { Key: 'job-43.json' },
      { Key: 'job-44.json' },
      { Key: 'job-45.json' },
    ]);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-43.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        name: 'job-43.json',
        state: 'created',
      })
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-44.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        name: 'job-44.json',
      })
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/job-45.json?x-id=GetObject')
      .reply(401)
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        jobs: [{ name: 'job-42', state: 'stopped' }],
      });

    class MockJob extends Job {
      // eslint-disable-next-line class-methods-use-this,no-unused-vars
      extractHistoryExtraInfo(state) {
        return {
          extra: 'data',
        };
      }
    }

    const job = await createMockJob(createContext(), createInfo(), 'test', 'job-42', MockJob);
    const resp = await job.list(createContext(), createInfo());
    assert.deepStrictEqual(await resp.json(), {
      jobs: [
        {
          href: 'https://api.aem.live/job/org/site/ref/test/job-42',
          name: 'job-42',
          state: 'stopped',
        },
        {
          href: 'https://api.aem.live/job/org/site/ref/test/job-43.json',
          name: 'job-43.json',
          state: 'created',
          extra: 'data',
        },
        {
          href: 'https://api.aem.live/job/org/site/ref/test/job-44.json',
          name: 'job-44.json',
          state: 'created',
          extra: 'data',
        },
      ],
      links: {
        self: 'https://api.aem.live/job/org/site/ref/test',
      },
      topic: 'test',
    });
  });

  it('encrypts and decrypts tokens correctly', async () => {
    const ctx = createContext({});
    const encrypted = encryptToken(ctx, 'hello, world');
    const decrypted = decryptToken(ctx, encrypted);
    assert.strictEqual(decrypted, 'hello, world');
  });

  describe('idleWait', () => {
    it('idleWait ignores timeout of 0', async () => {
      const job = await createJob(createContext(), createInfo(), 'test', 'job-123');
      await job.idleWait(0);
    });

    it('idleWait waits in 2sec intervals', async () => {
      const job = await createJob(createContext(), createInfo(), 'test', 'job-123');
      job.state = {};
      const clock = sinon.useFakeTimers({
        toFake: ['Date'],
      });
      const waits = [];
      job.writeState = () => {
        waits.push(job.state.waiting);
      };
      job.checkStopped = () => false;
      const sleeps = [];
      job.wait = (timeout) => {
        clock.tick(timeout);
        sleeps.push(timeout);
      };
      await job.idleWait(5000);
      clock.restore();
      assert.deepStrictEqual(waits, [5000, 3000, 1000, 0]);
      assert.deepStrictEqual(sleeps, [2000, 2000, 2000]);
    });

    it('idleWait aborts when stopped', async () => {
      const job = await createJob(createContext(), createInfo(), 'test', 'job-123');
      job.state = {};
      const clock = sinon.useFakeTimers({
        toFake: ['Date'],
      });
      const waits = [];
      job.writeState = () => {
        waits.push(job.state.waiting);
      };
      job.checkStopped = () => waits.length > 1;
      const sleeps = [];
      job.wait = (timeout) => {
        clock.tick(timeout);
        sleeps.push(timeout);
      };
      await job.idleWait(5000);
      clock.restore();
      assert.deepStrictEqual(waits, [5000, 3000, 0]);
      assert.deepStrictEqual(sleeps, [2000, 2000]);
    });
  });
});
