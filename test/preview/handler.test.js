/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
import assert from 'assert';
import sinon from 'sinon';
import { Request, Response } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { Job } from '../../src/job/job.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

describe('Preview Handler Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();

    nock.siteConfig(SITE_CONFIG);
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('return 405 with method not allowed', async () => {
    const suffix = '/org/sites/site/preview/document';

    const response = await main(new Request('https://api.aem.live/', {
      method: 'PUT',
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(response.status, 405);
    assert.strictEqual(await response.text(), 'method not allowed');
  });

  it('return 400 if `webPath` is illegal', async () => {
    const suffix = '/org/sites/site/preview/folder-/document';

    const response = await main(new Request('https://api.aem.live/'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(response.status, 400);
  });

  it('return 403 if `preview:read` permission missing', async () => {
    const suffix = '/org/sites/site/preview/document';

    const response = await main(new Request('https://api.aem.live/'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default()
          .withAuthenticated(true)
          .withProfile({ defaultRole: 'media_author' }),
      },
    });
    assert.strictEqual(response.status, 403);
  });

  it('return 403 if `preview:write` permission missing', async () => {
    const suffix = '/org/sites/site/preview/document';

    const response = await main(new Request('https://api.aem.live/', {
      method: 'POST',
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default()
          .withAuthenticated(true)
          .withProfile({ defaultRole: 'media_author' }),
      },
    });
    assert.strictEqual(response.status, 403);
  });

  it('forwards preview info status if not a 404', async () => {
    const suffix = '/org/sites/site/preview/document';

    nock.content()
      .head('/preview/document.md')
      .reply(403);

    const response = await main(new Request('https://api.aem.live/'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Basic().withAuthenticated(true),
        redirects: { preview: [] },
      },
      env: {
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
      },
    });
    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'error while fetching: 403',
    });
  });

  it('routes POST /* to bulk preview and returns 202', async () => {
    const suffix = '/org/sites/site/preview/*';
    sandbox.stub(Job, 'create').resolves(
      new Response(JSON.stringify({ job: { name: 'job-123', state: { status: 'created' } } }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['/foo/bar'] }),
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Admin().withAuthenticated(true),
      },
      env: {
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
      },
    });

    assert.strictEqual(response.status, 202);
    assert.ok(Job.create.calledOnce);
    const [, , topic, opts] = Job.create.firstCall.args;
    assert.strictEqual(topic, 'preview');
    assert.deepStrictEqual(opts.data.paths, ['/foo/bar']);
  });

  it('bulk preview returns 400 for missing paths', async () => {
    const suffix = '/org/sites/site/preview/*';

    const response = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Admin().withAuthenticated(true),
      },
      env: {
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
      },
    });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.headers.get('x-error'), 'bulk-preview payload is missing "paths".');
  });

  it('routes POST /* with delete:true to bulk remove and returns 202', async () => {
    const suffix = '/org/sites/site/preview/*';
    sandbox.stub(Job, 'create').resolves(
      new Response(JSON.stringify({ job: { name: 'job-123', state: { status: 'created' } } }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delete: true, paths: ['/foo/bar'] }),
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Admin().withAuthenticated(true),
      },
      env: {
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
      },
    });

    assert.strictEqual(response.status, 202);
    assert.ok(Job.create.calledOnce);
    const [, , topic] = Job.create.firstCall.args;
    assert.strictEqual(topic, 'preview-remove');
  });

  it('bulk remove returns 403 if preview:delete permission missing', async () => {
    const suffix = '/org/sites/site/preview/*';

    const response = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delete: true, paths: ['/foo/bar'] }),
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default()
          .withAuthenticated(true)
          .withProfile({ defaultRole: 'media_author' }),
      },
    });

    assert.strictEqual(response.status, 403);
  });

  it('bulk preview returns 403 if preview:write permission missing', async () => {
    const suffix = '/org/sites/site/preview/*';

    const response = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['/foo/bar'] }),
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default()
          .withAuthenticated(true)
          .withProfile({ defaultRole: 'media_author' }),
      },
    });

    assert.strictEqual(response.status, 403);
  });
});
