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
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

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
        nock.siteConfig(SITE_CONFIG, { org: 'org', site: 'site' });
        const result = await main(new Request('https://api.aem.live/', {
          method,
        }), {
          attributes: {
            authInfo: AuthInfo.Default().withAuthenticated(true),
          },
          pathInfo: {
            suffix: '/org/sites/site/jobs/topic/jobName',
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
    nock.siteConfig(SITE_CONFIG);
    const result = await main(new Request('https://api.aem.live/'), {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      pathInfo: {
        suffix: '/org/sites/site/jobs/foo/job-24',
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

  it('GET returns 404 for missing project', async () => {
    nock.siteConfig(null).reply(404);
    const result = await main(new Request('https://api.aem.live/'), {
      pathInfo: {
        suffix: '/org/sites/site/jobs/foo/job-24',
      },
    });
    assert.strictEqual(result.status, 404);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': '',
      vary: 'Accept-Encoding',
    });
  });

  it('GET returns job status', async () => {
    nock.siteConfig(SITE_CONFIG);
    nock.content()
      .getObject('/preview/.helix/admin-jobs/test/incoming/job-24.json')
      .reply(200, {
        state: 'running',
        data: {
          paths: '/foo',
        },
      });

    const result = await main(new Request('https://api.aem.live/'), {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      pathInfo: {
        suffix: '/org/sites/site/jobs/test/job-24',
      },
    });

    assert.strictEqual(result.status, 200);
    const data = await result.json();
    assert.deepStrictEqual(data, {
      links: {
        list: 'https://api.aem.live/org/sites/site/jobs/test',
        self: 'https://api.aem.live/org/sites/site/jobs/test/job-24',
        details: 'https://api.aem.live/org/sites/site/jobs/test/job-24/details',
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
    nock.siteConfig(SITE_CONFIG);
    nock.content()
      .getObject('/preview/.helix/admin-jobs/test/incoming/job-24.json')
      .reply(200, {
        state: 'running',
        user: 'foo@example.com',
        data: {
          paths: '/foo',
        },
      });

    const result = await main(new Request('https://api.aem.live/'), {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      pathInfo: {
        suffix: '/org/sites/site/jobs/test/job-24/details',
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
        job: 'https://api.aem.live/org/sites/site/jobs/test/job-24',
        list: 'https://api.aem.live/org/sites/site/jobs/test',
        self: 'https://api.aem.live/org/sites/site/jobs/test/job-24/details',
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('GET returns job status details, with user if set and authorized', async () => {
    nock.siteConfig(SITE_CONFIG);
    nock.content()
      .getObject('/preview/.helix/admin-jobs/test/incoming/job-24.json')
      .reply(200, {
        state: 'running',
        user: 'foo@example.com',
        data: {
          paths: '/foo',
        },
      });

    const result = await main(new Request('https://api.aem.live/'), {
      attributes: {
        authInfo: AuthInfo.Admin()
          .withAuthenticated(true)
          .withProfile({ user: 'admin@example.com' }),
      },
      pathInfo: {
        suffix: '/org/sites/site/jobs/test/job-24/details',
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
        job: 'https://api.aem.live/org/sites/site/jobs/test/job-24',
        list: 'https://api.aem.live/org/sites/site/jobs/test',
        self: 'https://api.aem.live/org/sites/site/jobs/test/job-24/details',
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('GET returns job status details, omits user if not authorized', async () => {
    nock.siteConfig(SITE_CONFIG);
    nock.content()
      .getObject('/preview/.helix/admin-jobs/test/incoming/job-24.json')
      .reply(200, {
        state: 'running',
        user: 'bar@example.com',
        data: {
          paths: '/foo',
        },
      });

    const result = await main(new Request('https://api.aem.live/'), {
      attributes: {
        authInfo: AuthInfo.Admin()
          .withAuthenticated(true)
          .withProfile({ user: 'user@example.com' })
          .removePermissions('log:read'),
      },
      pathInfo: {
        suffix: '/org/sites/site/jobs/test/job-24/details',
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
        job: 'https://api.aem.live/org/sites/site/jobs/test/job-24',
        list: 'https://api.aem.live/org/sites/site/jobs/test',
        self: 'https://api.aem.live/org/sites/site/jobs/test/job-24/details',
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('GET returns job list', async () => {
    nock.siteConfig(SITE_CONFIG);
    nock.listObjects('helix-content-bus', '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/', [
      { Key: 'job-43.json' },
    ]);

    nock.content()
      .getObject('/preview/.helix/admin-jobs/test/incoming/job-43.json')
      .reply(200, {
        topic: 'test',
        name: 'job-43.json',
        state: 'created',
      })
      .getObject('/preview/.helix/admin-jobs/test.json')
      .reply(200, {
        topic: 'test',
        jobs: [],
      });

    const result = await main(new Request('https://api.aem.live/'), {
      attributes: {
        authInfo: AuthInfo.Admin().withAuthenticated(true),
      },
      pathInfo: {
        suffix: '/org/sites/site/jobs/test',
      },
    });

    assert.strictEqual(result.status, 200);
    const data = await result.json();
    assert.deepStrictEqual(data, {
      topic: 'test',
      jobs: [
        {
          href: 'https://api.aem.live/org/sites/site/jobs/test/job-43.json',
          name: 'job-43.json',
          state: 'created',
        },
      ],
      links: {
        self: 'https://api.aem.live/org/sites/site/jobs/test',
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('DELETE returns 404 for missing job', async () => {
    nock.siteConfig(SITE_CONFIG);
    nock.content()
      .getObject('/preview/.helix/admin-jobs/test/incoming/job-24.json')
      .reply(404)
      .getObject('/preview/.helix/admin-jobs/test/job-24.json')
      .reply(404);

    const result = await main(new Request('https://api.aem.live/', { method: 'DELETE' }), {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      pathInfo: {
        suffix: '/org/sites/site/jobs/test/job-24',
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
    nock.siteConfig(SITE_CONFIG);
    nock.content()
      .getObject('/preview/.helix/admin-jobs/test/incoming/job-24.json')
      .reply(200, {
        state: 'running',
      });

    const result = await main(new Request('https://api.aem.live/', {
      method: 'RUN',
    }), {
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      pathInfo: {
        suffix: '/org/sites/site/jobs/test/job-24',
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
    nock.siteConfig(SITE_CONFIG);
    nock.content()
      .getObject('/preview/.helix/admin-jobs/test/incoming/job-24.json')
      .reply(200, {
        state: 'running',
      });

    const result = await main(new Request('https://api.aem.live/', {
      method: 'DELETE',
    }), {
      attributes: {
        authInfo: AuthInfo.Admin().withAuthenticated(true),
      },
      pathInfo: {
        suffix: '/org/sites/site/jobs/test/job-24',
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
    nock.siteConfig(SITE_CONFIG);
    JOB_CLASS.test = new Proxy(MockJob, {
      construct(target, args) {
        testJob = new TestJob(...args);
        return testJob;
      },
    });

    process.env.HLX_DEV_SERVER_HOST = 'http://localhost:3000';
    nock.listObjects('helix-content-bus', '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/admin-jobs/test/incoming/', []);
    nock.content()
      .getObject('/preview/.helix/admin-jobs/test.json')
      .times(2)
      .reply(200, {
        topic: 'test',
        jobs: [],
      })
      .putObject('/preview/.helix/admin-jobs/test.json')
      .reply(200)
      .put(/\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .times(5)
      .reply(200)
      .delete(/\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .reply(200)
      .put(/\/preview\/\.helix\/admin-jobs\/test\/job-(.*)\.json/)
      .reply(200)
      .get(/\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)-stop.json/)
      .reply(404)
      .delete(/\/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)-stop.json/)
      .reply(200)
      .get(/preview\/\.helix\/admin-jobs\/test\/incoming\/job-(.*)\.json/)
      .times(2)
      .reply(200, '{}');

    const result = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      body: JSON.stringify({ time: 1 }),
      headers: {
        'content-type': 'application/json',
      },
    }), {
      runtime: { region: 'us-east-1', accountId: 'account-id' },
      func: { fqn: 'helix-api-service' },
      invocation: { id: 'invocation-id' },
      attributes: {
        authInfo: AuthInfo.Admin().withAuthenticated(true),
      },
      pathInfo: {
        suffix: '/org/sites/site/jobs/test',
      },
    });

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      job: {},
      links: {
        list: 'https://http//localhost:3000/org/sites/site/jobs/test',
        self: `https://http//localhost:3000/org/sites/site/jobs/test/${testJob.name}`,
      },
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'application/json',
    });
  });
});
