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
import { Request } from '@adobe/fetch';
import { GoogleClient } from '@adobe/helix-google-support';
import { router } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';
import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { AdminContext } from '../../src/support/AdminContext.js';
import { RequestInfo } from '../../src/support/RequestInfo.js';
import web2edit from '../../src/lookup/web2edit.js';
import { StatusCodeError } from '../../src/support/StatusCodeError.js';

describe('web2edit Google Tests', () => {
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  function createContext(suffix, editUrl, attributes = {}) {
    return AdminContext.create({
      log: console,
      pathInfo: { suffix },
      data: { editUrl },
    }, { attributes });
  }

  function createInfo(suffix) {
    return RequestInfo.create(new Request('http://localhost/'), router.match(suffix).variables);
  }

  it('returns error when google lookup returns no results', async () => {
    const suffix = '/owner/sites/repo/status/page';

    nock.google
      .user()
      .documents([])
      .files([]);

    const result = await web2edit(
      createContext(suffix, 'auto', {
        authInfo: AuthInfo.Admin(),
        config: SITE_CONFIG,
        redirects: { preview: [], live: [] },
      }),
      createInfo(suffix),
    );
    assert.deepStrictEqual(result, {
      error: 'Handler google could not lookup hlx:/owner/repo/page.',
      status: 404,
    });
  });

  it('returns error when google lookup rejects', async () => {
    const suffix = '/owner/sites/repo/status/page';

    sandbox.stub(GoogleClient.prototype, 'getItemsFromPath').rejects(new StatusCodeError('boom!', 500));
    nock.google
      .user();

    const result = await web2edit(
      createContext(suffix, 'auto', {
        authInfo: AuthInfo.Admin(),
        config: SITE_CONFIG,
        redirects: { preview: [], live: [] },
      }),
      createInfo(suffix),
    );
    assert.deepStrictEqual(result, {
      error: 'Handler google could not lookup hlx:/owner/repo/page.',
      status: 500,
    });
  });

  it('adds a severity if the handler rejects with a `rateLimit`', async () => {
    const suffix = '/owner/sites/repo/status/page';

    const error = new Error('boom!');
    error.status = 429;
    error.rateLimit = 1000;

    sandbox.stub(GoogleClient.prototype, 'getItemsFromPath').rejects(error);
    nock.google
      .user();

    const result = await web2edit(
      createContext(suffix, 'auto', {
        authInfo: AuthInfo.Admin(),
        config: SITE_CONFIG,
        redirects: { preview: [], live: [] },
      }),
      createInfo(suffix),
    );
    assert.deepStrictEqual(result, {
      error: 'Handler google could not lookup hlx:/owner/repo/page.',
      severity: 'warn',
      status: 429,
    });
  });

  const OVERLAY_CONFIG = {
    ...SITE_CONFIG,
    content: {
      ...SITE_CONFIG.content,
      overlay: {
        type: 'markup',
        url: 'https://content.da.live/org/site/',
      },
    },
  };

  it('invokes `lookup` for both overlay and base', async () => {
    const suffix = '/owner/sites/repo/status/page';

    nock('https://content.da.live:443')
      .get('/org/site/page')
      .reply(404);

    nock.google
      .user()
      .documents([])
      .files([]);

    const result = await web2edit(
      createContext(suffix, 'auto', {
        authInfo: AuthInfo.Admin(),
        config: OVERLAY_CONFIG,
        redirects: { preview: [], live: [] },
      }),
      createInfo(suffix),
    );
    assert.deepStrictEqual(result, {
      editUrl: 'https://da.live/edit#/org/site/page',
      resourcePath: '/page.md',
      sourceLocation: 'markup:https://content.da.live/org/site/page',
      status: 404,
      webPath: '/page',
    });
  });
});
