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
import { GoogleClient } from '@adobe/helix-google-support';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';

describe('Google Integration Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
    GoogleClient.setItemCacheOptions({ max: 1000 });

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/', { data } = {}) {
    const suffix = `/org/sites/site/contentproxy${path}`;
    const query = new URLSearchParams(data);

    const request = new Request(`https://localhost${suffix}?${query}`, {
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

  it('Retrieves Document from gdocs', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .documents([{
        mimeType: 'application/vnd.google-apps.document',
        name: 'index',
        id: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
      }]);

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--gdocs2md%3Av7/invocations')
      .reply((_, requestBody) => {
        const { headers, rawQueryString } = JSON.parse(requestBody);
        assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(rawQueryString).entries()), {
          contentBusId: SITE_CONFIG.content.contentBusId,
          owner: 'org',
          repo: 'site',
          org: 'org',
          site: 'site',
          ref: 'main',
          rid: 'rid',
          mediaBucket: 'helix-media-bus',
          rootId: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
        });
        assert.strictEqual(headers.authorization, 'Bearer dummy-access-token');
        return [200, JSON.stringify({
          statusCode: 200,
          headers: {
            'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
          },
          body: '# hello, world!',
        })];
      });

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
    assert.strictEqual(response.headers.get('x-source-location'), 'gdrive:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE');
  });

  it('Retrieves Document from gdocs with selected version', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .documents([{
        mimeType: 'application/vnd.google-apps.document',
        name: 'index',
        id: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
      }]);

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--gdocs2md%3Aci123/invocations')
      .reply(200, JSON.stringify({
        statusCode: 200,
        headers: {},
        body: '# hello, world!',
      }));

    const { request, context } = setupTest('/', {
      data: { 'hlx-gdocs2md-version': 'ci123' },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
  });

  it('Retrieves Document from gdocs with If-Modified-Since', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .documents([{
        mimeType: 'application/vnd.google-apps.document',
        name: 'index',
        id: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
      }]);

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--gdocs2md%3Av7/invocations')
      .reply((_, requestBody) => {
        const { headers, rawQueryString } = JSON.parse(requestBody);
        assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(rawQueryString).entries()), {
          contentBusId: SITE_CONFIG.content.contentBusId,
          owner: 'org',
          repo: 'site',
          org: 'org',
          site: 'site',
          ref: 'main',
          rid: 'rid',
          mediaBucket: 'helix-media-bus',
          rootId: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
        });
        assert.strictEqual(headers['if-modified-since'], 'Tue, 10 Jun 2021 20:04:53 GMT');
        return [200, JSON.stringify({
          statusCode: 304,
          headers: {},
          body: '',
        })];
      });

    const { request, context } = setupTest('/', {
      data: {
        lastModified: 'Tue, 10 Jun 2021 20:04:53 GMT',
      },
    });
    const response = await main(request, context);
    assert.strictEqual(response.status, 304);
  });

  it('Handles 404 from gdocs', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .documents([{
        mimeType: 'application/vnd.google-apps.document',
        name: 'index',
        id: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
      }]);

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--gdocs2md%3Av7/invocations')
      .reply(200, JSON.stringify({
        statusCode: 404,
        headers: {},
        body: '',
      }));

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });

  it('returns 415 for .md', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .documents([{
        mimeType: 'text/markdown',
        name: 'test.md',
        id: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
      }]);

    const { request, context } = setupTest('/test');
    const response = await main(request, context);

    assert.strictEqual(response.status, 415);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to preview \'/test.md\': File type not supported: text/markdown',
      'x-error-code': 'AEM_BACKEND_TYPE_UNSUPPORTED',
    });
  });

  it('Handles 404 from gdrive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .documents([])
      .files([]);

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });
});
