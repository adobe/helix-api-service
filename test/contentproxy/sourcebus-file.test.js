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
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

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

describe('Source Bus Content Proxy Tests (JSON)', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env({
      HELIX_STORAGE_DISABLE_R2: 'true',
    });
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
        MEDIAHANDLER_NOCACHHE: 'true',
      },
    };
    return { request, context };
  }

  it('Retrieves pdf from source bus', async () => {
    nock.source()
      .getObject('/org/site/empty.pdf')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/empty.pdf'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'application/pdf',
      });

    const { request, context } = setupTest('/empty.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'application/pdf',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
      'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
    });
  });

  it('Rejects preview if source.url has the correct format', async () => {
    const { request, context } = setupTest('/data.pdf', {
      config: {
        ...SITE_MUP_CONFIG('https://api.aem.live/org/sites/status'),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'Source url must be in the format: https://api.aem.live/<org>/sites/<site>/source. Got: https://api.aem.live/org/sites/status',
    });
  });

  it('Returns 404 if resource is not found in source bus', async () => {
    nock.source()
      .getObject('/org/site/missing.pdf')
      .reply(404);

    const { request, context } = setupTest('/missing.pdf', {
      config: {
        ...SITE_MUP_CONFIG(),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });
});
