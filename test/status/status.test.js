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
import { Request } from '@adobe/fetch';
import { router } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';
import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { AdminContext } from '../../src/support/AdminContext.js';
import { RequestInfo } from '../../src/support/RequestInfo.js';
import status from '../../src/status/status.js';

describe('Status GET Tests', () => {
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function createContext(suffix, editUrl, attributes = {}) {
    return new AdminContext({
      log: console,
      pathInfo: { suffix },
      data: { editUrl },
    }, { attributes });
  }

  function createInfo(suffix) {
    return RequestInfo.create(new Request('http://localhost/'), router.match(suffix).variables);
  }

  it('return 400 if `editUrl` is not auto and `webPath` is not `/`', async () => {
    const suffix = '/owner/sites/repo/status/document';

    const result = await status(
      createContext(suffix, 'other'),
      createInfo(suffix),
    );

    assert.strictEqual(result.status, 400);
  });

  it('throws if `editUrl` is not auto and user lacks permissions', async () => {
    const suffix = '/owner/sites/repo/status/';

    const result = () => status(
      createContext(suffix, 'other', { authInfo: AuthInfo.Default() }),
      createInfo(suffix),
    );

    assert.rejects(
      result(),
      /forbidden/,
    );
  });

  it('sets status to `403` if `editUrl` is `auto` and user lacks permissions', async () => {
    const suffix = '/owner/sites/repo/status/';

    const result = await status(
      createContext(suffix, 'auto', { authInfo: AuthInfo.Default() }),
      createInfo(suffix),
    );

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      edit: {
        status: 403,
      },
      live: {
        error: 'forbidden',
        status: 403,
        url: 'https://main--repo--owner.aem.live/',
      },
      preview: {
        error: 'forbidden',
        status: 403,
        url: 'https://main--repo--owner.aem.page/',
      },
      resourcePath: '/index.md',
      webPath: '/',
    });
  });

  it('calls `web2edit` when `editUrl` is `auto`', async () => {
    const suffix = '/owner/sites/repo/status/';

    nock.content()
      .head('/preview/index.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
      .head('/live/index.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const result = await status(
      createContext(suffix, 'auto', {
        authInfo: AuthInfo.Admin(),
        config: SITE_CONFIG,
        redirects: {
          preview: [],
          live: [],
        },
      }),
      createInfo(suffix),
    );
    assert.strictEqual(result.status, 200);
  });

  it('calls `web2edit` when `editUrl` is not `auto`', async () => {
    const suffix = '/owner/sites/repo/status/';

    nock.content()
      .head('/preview/index.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
      .head('/live/index.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const result = await status(
      createContext(suffix, 'other', {
        authInfo: AuthInfo.Admin(),
        config: SITE_CONFIG,
        redirects: {
          preview: [],
          live: [],
        },
      }),
      createInfo(suffix),
    );
    assert.strictEqual(result.status, 200);
  });
});
