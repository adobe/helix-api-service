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
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import {
  Nock, SITE_CONFIG, ORG_CONFIG,
} from '../utils.js';

describe('Preview Handler Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  it('return 405 with method not allowed', async () => {
    const suffix = '/org/sites/site/preview/document';

    const result = await main(new Request('https://localhost/', { method: 'PUT' }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'method not allowed');
  });

  it('return 400 if `webPath` is illegal', async () => {
    const suffix = '/org/sites/site/preview/folder-/document';

    const result = await main(new Request('https://api.aem.live/'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 400);
  });

  it('return 403 if `preview:read` permission missing', async () => {
    const suffix = '/org/sites/site/preview/document';

    const result = await main(new Request('https://api.aem.live/'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default()
          .withAuthenticated(true)
          .withProfile({ defaultRole: 'media_author' }),
      },
    });
    assert.strictEqual(result.status, 403);
  });

  it('returns preview info', async () => {
    const suffix = '/org/sites/site/preview/document';

    nock.content()
      .getObject('/preview/redirects.json')
      .reply(404)
      .head('/preview/document.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 09:04:16 GMT' });

    const result = await main(new Request('https://api.aem.live/'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      preview: {
        contentBusId: 'helix-content-bus/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/document.md',
        contentType: 'text/plain; charset=utf-8',
        lastModified: 'Thu, 08 Jul 2021 09:04:16 GMT',
        permissions: [
          'delete',
          'read',
          'write',
        ],
        sourceLocation: 'google:*',
        status: 200,
        url: 'https://main--site--org.aem.page/document',
      },
      resourcePath: '/document.md',
      webPath: '/document',
    });
  });
});
