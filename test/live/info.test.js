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
import { Nock, SITE_CONFIG } from '../utils.js';

describe('Live Info Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/') {
    const suffix = `/org/sites/site/live${path}`;

    const request = new Request(`https://api.aem.live${suffix}`, {
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        googleApiOpts: { retry: false },
      },
      runtime: { region: 'us-east-1' },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    };
    return { request, context };
  }

  it('returns live info', async () => {
    nock.content()
      .getObject('/live/redirects.json')
      .reply(404)
      .head('/live/document.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 09:04:16 GMT' });

    const { request, context } = setupTest('/document');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      links: {
        code: 'https://api.aem.live/org/sites/site/code/main/document',
        live: 'https://api.aem.live/org/sites/site/live/document',
        preview: 'https://api.aem.live/org/sites/site/preview/document',
        status: 'https://api.aem.live/org/sites/site/status/document',
      },
      live: {
        contentBusId: `helix-content-bus/${SITE_CONFIG.content.contentBusId}/live/document.md`,
        contentType: 'text/plain; charset=utf-8',
        lastModified: 'Thu, 08 Jul 2021 09:04:16 GMT',
        permissions: [
          'delete',
          'read',
          'write',
        ],
        sourceLocation: 'google:*',
        status: 200,
        url: 'https://main--site--org.aem.live/document',
      },
      resourcePath: '/document.md',
      webPath: '/document',
    });
  });
});
