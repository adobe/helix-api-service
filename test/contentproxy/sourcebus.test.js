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
import { resolve } from 'path';
import assert from 'assert';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

const gunzipAsync = promisify(gunzip);

const SITE_MUP_CONFIG = (url = 'https://api.aem.live/org/sites/site/source') => ({
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'markup',
      url,
    },
  },
});

describe('Source Bus Content Proxy Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/', {
    config = SITE_MUP_CONFIG(), data,
    authInfo = AuthInfo.Default().withAuthenticated(true),
  } = {}) {
    nock.siteConfig(config);

    const suffix = `/org/sites/site/contentproxy${path}`;
    const query = new URLSearchParams(data);

    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo,
        maxAttempts: 1,
      },
      runtime: { region: 'us-east-1' },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    };
    return { request, context };
  }

  it('Retrieves Document from source bus', async () => {
    nock.source()
      .getObject('/index.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/index.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });

    const { request, context } = setupTest('/', {
      config: {
        ...SITE_MUP_CONFIG(),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# Hello, world.\n\nTesting, source bus.\n');
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/markdown',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
      'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
    });
  });
});
