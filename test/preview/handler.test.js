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

    const response = await main(new Request('https://localhost/', { method: 'PUT' }), {
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
});
