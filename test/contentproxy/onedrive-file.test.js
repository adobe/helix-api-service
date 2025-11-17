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
import { resolve } from 'path';
import { Request } from '@adobe/fetch';
import { AcquireMethod, OneDrive } from '@adobe/helix-onedrive-support';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

const SITE_1D_CONFIG = {
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'onedrive',
      url: 'https://adobe.sharepoint.com/sites/Site/Shared%20Documents/site',
    },
  },
};

const ENV = {
  AZURE_HELIX_SERVICE_CLIENT_ID: 'dummy',
  AZURE_HELIX_SERVICE_CLIENT_SECRET: 'dummy',
  AZURE_HELIX_SERVICE_ACQUIRE_METHOD: AcquireMethod.BY_CLIENT_CREDENTIAL,
};

describe('OneDrive Integration Tests (file)', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_1D_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/', env = ENV) {
    const suffix = `/org/sites/site/contentproxy${path}`;

    const request = new Request('https://api.aem.live/');
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
        ...env,
      },
    };
    return { request, context };
  }

  it('Rejects file with excessive size', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getFile('/video.mp4', { size: 600_000_000 });

    const { request, context } = setupTest('/video.mp4');
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Files larger than 500mb are not supported: /video.mp4',
      'x-error-code': 'AEM_BACKEND_RESOURCE_TOO_BIG',
    });
  });

  it('Retrieves pdf from onedrive', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getFile('/foobar.pdf', {
        mimeType: 'application/octet-stream',
      })
      .getContent('file-id')
      .query(true)
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/empty.pdf'), {
        'content-type': 'application/pdf',
      });

    const { request, context } = setupTest('/foobar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'application/octet-stream');
    assert.strictEqual(response.headers.get('x-source-location'), 'onedrive:/drives/drive-id/items/file-id');
  });

  it('Handles 404 from onedrive', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getFile('/foobar.pdf', { id: null })
      .getChildren([]);

    const { request, context } = setupTest('/foobar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/foobar.pdf\' from \'onedrive\': (404) - no such document: /foobar.pdf');
  });

  it('Handles server error from onedrive', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login();
    nock('https://graph.microsoft.com/v1.0')
      .get(`/shares/${OneDrive.encodeSharingUrl(SITE_1D_CONFIG.content.source.url)}/driveItem`)
      .reply(429);

    const { request, context } = setupTest('/foobar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 503);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/foobar.pdf\' from \'onedrive\': (429) - ');
  });

  it('Handles server error from onedrive (429, retry)', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login();
    nock('https://graph.microsoft.com/v1.0')
      .get(`/shares/${OneDrive.encodeSharingUrl(SITE_1D_CONFIG.content.source.url)}/driveItem`)
      .reply(429, '{}', {
        'retry-after': '4',
      });

    const { request, context } = setupTest('/foobar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 503);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/foobar.pdf\' from \'onedrive\': (429) - ');
    assert.strictEqual(response.headers.get('retry-after'), '4');
  });

  it('Handles severe server error from onedrive', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user();

    const { request, context } = setupTest('/foobar.pdf', {});
    const response = await main(request, context);

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/foobar.pdf\' from \'onedrive\': Either clientId or accessToken must not be null.');
  });
});
