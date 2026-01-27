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
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { JOB_CLASS } from '../../src/job/handler.js';
import { Job } from '../../src/job/job.js';
import { TestJob } from '../../src/job/test-job.js';
import { DEFAULT_CONTEXT, Nock, main } from '../utils.js';

class MockJob extends Job {
  async invoke() {
    this.invoked = true;
  }

  async stop() {
    this.stopped = true;
  }
}

describe('Job Handler Tests', () => {
  let testJob;
  const clazz = new Proxy(MockJob, {
    construct(target, args) {
      testJob = new MockJob(...args);
      return testJob;
    },
  });

  let nock;
  beforeEach(() => {
    nock = new Nock().env();
    JOB_CLASS.test = clazz;
  });

  afterEach(() => {
    nock.done();
    delete JOB_CLASS.test;
  });

  describe('handles not allowed methods', () => {
    for (const method of ['POST', 'PUT']) {
      // eslint-disable-next-line no-loop-func
      it(`${method} sends method not allowed`, async () => {
        nock.config(null, 'org', 'site', 'ref');
        const result = await main(new Request('https://admin.hlx.page/', {
          method,
        }), {
          ...DEFAULT_CONTEXT(),
          pathInfo: {
            suffix: '/job/org/site/ref/topic/jobName',
          },
        });
        assert.strictEqual(result.status, 405);
        assert.strictEqual(await result.text(), 'method not allowed');
        assert.deepStrictEqual(result.headers.plain(), {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store, private, must-revalidate',
        });
      });
    }
  });

  it('GET returns 404 for invalid job topic', async () => {
    nock.config(null, 'org', 'site', 'ref');
    const result = await main(new Request('https://admin.hlx.page/'), {
      ...DEFAULT_CONTEXT(),
      pathInfo: {
        suffix: '/job/org/site/ref/foo/job-24',
      },
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  for (let i = 0; i < 4; i += 1) {
    const segs = ['org', 'site', 'ref', 'topic'];
    const suffix = `/job/${segs.slice(0, i).join('/')}`;
    // eslint-disable-next-line no-loop-func
    it(`GET returns 400 for missing ${segs[i]} parameter`, async () => {
      if (segs[i] === 'topic' || segs[i] === 'ref') {
        nock.config(null, 'org', 'site', 'ref');
      }
      const result = await main(new Request('https://admin.hlx.page/'), {
        ...DEFAULT_CONTEXT(),
        pathInfo: {
          suffix,
        },
      });
      assert.strictEqual(result.status, 400);
      assert.strictEqual(await result.text(), '');
      assert.deepStrictEqual(result.headers.plain(), {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store, private, must-revalidate',
        'x-error': `invalid path parameters: "${segs[i]}" is required`,
      });
    });
  }

  it('GET returns 404 for missing project', async () => {
    nock.config(null, 'org', 'site', 'ref');
    const result = await main(new Request('https://admin.hlx.page/'), {
      ...DEFAULT_CONTEXT({ attributes: { contentBusId: null } }),
      pathInfo: {
        suffix: '/job/org/site/ref/foo/job-24',
      },
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), 'project not found');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  // it('fetches contentbusid via github bot', async () => {
  //   // see tests in update.test.js
  // });

  it('GET returns job status', async () => {
    nock.config(null, 'org', 'site', 'ref');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/admin-jobs/test/incoming/job-24.json?x-id=GetObject')
      .reply(200, {
        state: 'running',
        data: {
          paths: '/foo',
        },
      });

    const result = await main(new Request('https://admin.hlx.page/'), {
      ...DEFAULT_CONTEXT(),
      pathInfo: {
        suffix: '/job/org/site/ref/test/job-24',
      },
    });

    assert.strictEqual(result.status, 200);
    const data = await result.json();
    assert.deepStrictEqual(data, {
      links: {
        list: 'https://admin.hlx.page/job/org/site/ref/test',
        self: 'https://admin.hlx.page/job/org/site/ref/test/job-24',
        details: 'https://admin.hlx.page/job/org/site/ref/test/job-24/details',
      },
      state: 'running',
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('GET returns job status details', async () => {
    nock.config(null, 'org', 'site', 'ref');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/admin-jobs/test/incoming/job-24.json?x-id=GetObject')
      .reply(200, {
        state: 'running',
        user: 'foo@example.com',
        data: {
          paths: '/foo',
        },
      });

    const result = await main(new Request('https://admin.hlx.page/'), {
      ...DEFAULT_CONTEXT(),
      pathInfo: {
        suffix: '/job/org/site/ref/test/job-24/details',
      },
    });

    assert.strictEqual(result.status, 200);
    const data = await result.json();
    assert.deepStrictEqual(data, {
      data: {
        paths: '/foo',
      },
      state: 'running',
      links: {
        job: 'https://admin.hlx.page/job/org/site/ref/test/job-24',
        list: 'https://admin.hlx.page/job/org/site/ref/test',
        self: 'https://admin.hlx.page/job/org/site/ref/test/job-24/details',
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('GET returns job status details, with user if set and authorized', async () => {
    nock.config(null, 'org', 'site', 'ref');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/admin-jobs/test/incoming/job-24.json?x-id=GetObject')
      .reply(200, {
        state: 'running',
        user: 'foo@example.com',
        data: {
          paths: '/foo',
        },
      });

    const result = await main(new Request('https://admin.hlx.page/'), {
      ...DEFAULT_CONTEXT({
        attributes: {
          authInfo: AuthInfo.Admin().withProfile({ user: 'admin@example.com' }),
        },
      }),
      pathInfo: {
        suffix: '/job/org/site/ref/test/job-24/details',
      },
    });

    assert.strictEqual(result.status, 200);
    const data = await result.json();
    assert.deepStrictEqual(data, {
      data: {
        paths: '/foo',
      },
      state: 'running',
      user: 'foo@example.com',
      links: {
        job: 'https://admin.hlx.page/job/org/site/ref/test/job-24',
        list: 'https://admin.hlx.page/job/org/site/ref/test',
        self: 'https://admin.hlx.page/job/org/site/ref/test/job-24/details',
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('GET returns job status details, omits user if not authorized', async () => {
    nock.config(null, 'org', 'site', 'ref');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/admin-jobs/test/incoming/job-24.json?x-id=GetObject')
      .reply(200, {
        state: 'running',
        user: 'bar@example.com',
        data: {
          paths: '/foo',
        },
      });

    const result = await main(new Request('https://admin.hlx.page/'), {
      ...DEFAULT_CONTEXT({
        attributes: {
          authInfo: AuthInfo.Admin()
            .withProfile({ user: 'user@example.com' })
            .removePermissions('log:read'),
        },
      }),
      pathInfo: {
        suffix: '/job/org/site/ref/test/job-24/details',
      },
    });

    assert.strictEqual(result.status, 200);
    const data = await result.json();
    assert.deepStrictEqual(data, {
      data: {
        paths: '/foo',
      },
      state: 'running',
      links: {
        job: 'https://admin.hlx.page/job/org/site/ref/test/job-24',
        list: 'https://admin.hlx.page/job/org/site/ref/test',
        self: 'https://admin.hlx.page/job/org/site/ref/test/job-24/details',
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('GET returns job list', async () => {
    nock.config(null, 'org', 'site', 'ref');
    nock.listObjects('helix-content-bus', 'foo-id/preview/.helix/admin-jobs/test/incoming/', [
      { Key: 'job-43.json' },
    ]);

    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/admin-jobs/test/incoming/job-43.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        name: 'job-43.json',
        state: 'created',
      })
      .get('/foo-id/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .reply(200, {
        topic: 'test',
        jobs: [],
      });

    const result = await main(new Request('https://admin.hlx.page/'), {
      ...DEFAULT_CONTEXT({
        attributes: {
          authInfo: AuthInfo.Admin().withAuthenticated(true),
        },
      }),
      pathInfo: {
        suffix: '/job/org/site/ref/test',
      },
    });

    assert.strictEqual(result.status, 200);
    const data = await result.json();
    assert.deepStrictEqual(data, {
      topic: 'test',
      jobs: [
        {
          href: 'https://admin.hlx.page/job/org/site/ref/test/job-43.json',
          name: 'job-43.json',
          state: 'created',
        },
      ],
      links: {
        self: 'https://admin.hlx.page/job/org/site/ref/test',
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('GET returns job list (index topic)', async () => {
    nock.config(null, 'org', 'site', 'ref');
    nock.listObjects('helix-content-bus', 'foo-id/preview/.helix/admin-jobs/index/incoming/', []);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/admin-jobs/index.json?x-id=GetObject')
      .reply(200, {
        topic: 'index',
        jobs: [],
      });

    const result = await main(new Request('https://admin.hlx.page/'), {
      ...DEFAULT_CONTEXT({
        attributes: {
          authInfo: AuthInfo.Admin().withAuthenticated(true),
        },
      }),
      pathInfo: {
        suffix: '/job/org/site/ref/index',
      },
    });

    assert.strictEqual(result.status, 200);
    const data = await result.json();
    assert.deepStrictEqual(data, {
      topic: 'index',
      jobs: [],
      links: {
        self: 'https://admin.hlx.page/job/org/site/ref/index',
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('DELETE returns 404 for missing job', async () => {
    nock.config(null, 'org', 'site', 'ref');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/admin-jobs/test/incoming/job-24.json?x-id=GetObject')
      .reply(404)
      .get('/foo-id/preview/.helix/admin-jobs/test/job-24.json?x-id=GetObject')
      .reply(404);

    const result = await main(new Request('https://admin.hlx.page/', { method: 'DELETE' }), {
      ...DEFAULT_CONTEXT(),
      pathInfo: {
        suffix: '/job/org/site/ref/test/job-24',
      },
    });

    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('RUN invokes the job', async () => {
    nock.config(null, 'org', 'site', 'ref');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/admin-jobs/test/incoming/job-24.json?x-id=GetObject')
      .reply(200, {
        state: 'running',
      });

    const result = await main.unbundled(new Request('https://admin.hlx.page/', {
      method: 'RUN',
    }), {
      ...DEFAULT_CONTEXT(),
      pathInfo: {
        suffix: '/job/org/site/ref/test/job-24',
      },
    });

    assert.strictEqual(testJob.invoked, true);
    assert.strictEqual(result.status, 204);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
    });
  });

  it('DELETE stops the job', async () => {
    nock.config(null, 'org', 'site', 'ref');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/admin-jobs/test/incoming/job-24.json?x-id=GetObject')
      .reply(200, {
        state: 'running',
      });

    const result = await main.unbundled(new Request('https://admin.hlx.page/', {
      method: 'DELETE',
    }), {
      ...DEFAULT_CONTEXT({
        attributes: {
          authInfo: AuthInfo.Admin().withAuthenticated(true),
        },
      }),
      pathInfo: {
        suffix: '/job/org/site/ref/test/job-24',
      },
    });

    assert.strictEqual(testJob.stopped, true);
    assert.strictEqual(result.status, 204);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
    });
  });

  it('POST to test creates test job', async () => {
    nock.config(null, 'org', 'site', 'ref');
    JOB_CLASS.test = new Proxy(MockJob, {
      construct(target, args) {
        testJob = new TestJob(...args);
        return testJob;
      },
    });

    process.env.HLX_DEV_SERVER_HOST = 'http://localhost:3000';
    nock.audit();
    nock.listObjects('helix-content-bus', 'foo-id/preview/.helix/admin-jobs/test/incoming/', []);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/admin-jobs/test.json?x-id=GetObject')
      .times(2)
      .reply(200, {
        topic: 'test',
        jobs: [],
      })
      .put('/foo-id/preview/.helix/admin-jobs/test.json?x-id=PutObject')
      .reply(200)
      .put(/\/foo-id\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .times(5)
      .reply(200)
      .delete(/\/foo-id\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .reply(200)
      .put(/\/foo-id\/preview\/\.helix\/admin-jobs\/test\/job-(.*)\.json/)
      .reply(200)
      .get(/\/foo-id\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)-stop.json\?x-id=GetObject/)
      .reply(404)
      .delete(/\/foo-id\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)-stop.json\?x-id=DeleteObject/)
      .reply(200)
      .get(/\/foo-id\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .times(2)
      .reply(200, '{}');

    const result = await main.unbundled(new Request('https://admin.hlx.page/', {
      method: 'POST',
      body: JSON.stringify({ time: 1 }),
      headers: {
        'content-type': 'application/json',
      },
    }), {
      ...DEFAULT_CONTEXT({
        attributes: {
          authInfo: AuthInfo.Admin().withAuthenticated(true),
        },
      }),
      pathInfo: {
        suffix: '/job/org/site/ref/test',
      },
    });

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      job: {},
      links: {
        list: 'https://http//localhost:3000/job/org/site/ref/test',
        self: `https://http//localhost:3000/job/org/site/ref/test/${testJob.name}`,
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'application/json',
    });
  });
});
