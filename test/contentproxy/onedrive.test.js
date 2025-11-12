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
import { AcquireMethod } from '@adobe/helix-onedrive-support';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';

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

const DEFAULT_BODY = {
  shareLink: 'onedrive:/drives/drive-id/items/document-id',
  contentBusId: SITE_1D_CONFIG.content.contentBusId,
  owner: 'org',
  repo: 'site',
  org: 'org',
  site: 'site',
  ref: 'main',
  rid: 'rid',
  mediaBucket: 'helix-media-bus',
  resourcePath: '/index.md',
};

const ENV = {
  AZURE_HELIX_SERVICE_CLIENT_ID: 'dummy',
  AZURE_HELIX_SERVICE_CLIENT_SECRET: 'dummy',
  AZURE_HELIX_SERVICE_ACQUIRE_METHOD: AcquireMethod.BY_CLIENT_CREDENTIAL,
};

describe('OneDrive Integration Tests (docx)', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/', { config = SITE_1D_CONFIG, data } = {}) {
    nock.siteConfig(config);

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
      },
      runtime: { region: 'us-east-1' },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
        ...ENV,
      },
    };
    return { request, context };
  }

  it('Retrieves Document from Word', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/index.docx', { size: 3956 });

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--word2md%3Av7/invocations')
      .reply((_, requestBody) => {
        const { rawQueryString } = JSON.parse(requestBody);
        assert.deepStrictEqual(
          Object.fromEntries(new URLSearchParams(rawQueryString).entries()),
          DEFAULT_BODY,
        );
        return [200, JSON.stringify({
          statusCode: 200,
          headers: {
            'x-source-location': '/drives/b!PpnkewKFAEaDTS6slvlVjh_3ih9lhEZMgYWwps6bPIWZMmLU5xGqS4uES8kIQZbH/items/01DJQLOW44UHM362CKX5GYMQO2F4JIHSEV',
            'last-modified': 'Tue, 10 Jun 2021 20:04:53 GMT',
          },
          body: '# hello, world!',
        })];
      });

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
    assert.strictEqual(response.headers.get('x-source-location'), 'onedrive:/drives/b!PpnkewKFAEaDTS6slvlVjh_3ih9lhEZMgYWwps6bPIWZMmLU5xGqS4uES8kIQZbH/items/01DJQLOW44UHM362CKX5GYMQO2F4JIHSEV');
  });

  it('Rejects markdown', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getFile('/test.docx', { name: 'test.md' });

    const { request, context } = setupTest('/test');
    const response = await main(request, context);

    assert.strictEqual(response.status, 415);
    assert.strictEqual(response.headers.get('x-error'), 'File type not supported: markdown');
  });

  it('Rejects something other than a Word document', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getFile('/test.docx', {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        name: 'test.xlsx',
        size: 3956,
      });

    const { request, context } = setupTest('/test');
    const response = await main(request, context);

    assert.strictEqual(response.status, 415);
    assert.strictEqual(response.headers.get('x-error'), 'File type not supported: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('Rejects empty Word document', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/test.docx', { size: 0 });

    const { request, context } = setupTest('/test');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.headers.get('x-error'), 'File is empty, no markdown version available: /test.md');
  });

  it('Rejects documents larger than 100mb', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/test.docx', { size: 101 * 1024 * 1024 + 1 });

    const { request, context } = setupTest('/test');
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to preview \'/test\': Documents larger than 100mb not supported: 101MB');
    assert.strictEqual(response.headers.get('x-error-code'), 'AEM_BACKEND_FILE_TOO_BIG');
  });

  it('Retrieves Document from Word with selected version', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/index.docx', { size: 3956 });

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--word2md%3Aci123/invocations')
      .reply(200, JSON.stringify({
        statusCode: 200,
        headers: {},
        body: '# hello, world!',
      }));

    const { request, context } = setupTest('/', {
      data: { 'hlx-word2md-version': 'ci123' },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
  });

  it('Retrieves Document from Word via custom tenant', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login(undefined, '01234567-abcd', '01234567-abcd')
      .resolve('')
      .getDocument('/index.docx', { size: 3956 });

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--word2md%3Av7/invocations')
      .reply((_, requestBody) => {
        const { rawQueryString } = JSON.parse(requestBody);
        assert.deepStrictEqual(
          Object.fromEntries(new URLSearchParams(rawQueryString).entries()),
          DEFAULT_BODY,
        );
        return [200, JSON.stringify({
          statusCode: 200,
          headers: {
            'x-source-location': '/drives/b!PpnkewKFAEaDTS6slvlVjh_3ih9lhEZMgYWwps6bPIWZMmLU5xGqS4uES8kIQZbH/items/01DJQLOW44UHM362CKX5GYMQO2F4JIHSEV',
            'last-modified': 'Tue, 10 Jun 2021 20:04:53 GMT',
          },
          body: '# hello, world!',
        })];
      });

    const { request, context } = setupTest('/', {
      config: {
        ...SITE_1D_CONFIG,
        content: {
          ...SITE_1D_CONFIG.content,
          source: {
            ...SITE_1D_CONFIG.content.source,
            tenantId: '01234567-abcd',
          },
        },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
    assert.strictEqual(response.headers.get('x-source-location'), 'onedrive:/drives/b!PpnkewKFAEaDTS6slvlVjh_3ih9lhEZMgYWwps6bPIWZMmLU5xGqS4uES8kIQZbH/items/01DJQLOW44UHM362CKX5GYMQO2F4JIHSEV');
  });

  it('Retrieves Document from Word with If-Modified-Since', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/index.docx', { size: 3956 });

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--word2md%3Av7/invocations')
      .reply((_, requestBody) => {
        const { rawQueryString, headers } = JSON.parse(requestBody);
        assert.deepStrictEqual(
          Object.fromEntries(new URLSearchParams(rawQueryString).entries()),
          DEFAULT_BODY,
        );
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

  it('Handles 429s from word2md', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/index.docx', { id: null })
      .getChildren([{
        id: 'document-id',
        lastModifiedDateTime: 'Thu, 08 Jul 2021 10:04:16 GMT',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        name: 'index.docx',
        size: 3956,
      }]);

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--word2md%3Av7/invocations')
      .reply(200, JSON.stringify({
        statusCode: 429,
        headers: {
          'retry-after': '4',
          'x-error': 'The request been throttled',
        },
        body: '',
      }));

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 503);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/index.md\' from \'word2md\': (429) - The request been throttled');
    assert.strictEqual(response.headers.get('retry-after'), '4');
    assert.strictEqual(response.headers.get('x-severity'), 'warn');
  });

  it('Handles connection error from word2md', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/index.docx', { size: 3956 });

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--word2md%3Av7/invocations')
      .replyWithError('kaputt');

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/index.md\' from \'word2md\': kaputt');
  });

  it('Handles 404 from word2md', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/index.docx', { size: 3956 });

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--word2md%3Av7/invocations')
      .reply(200, JSON.stringify({
        statusCode: 404,
        headers: {},
        body: '',
      }));

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });

  it('Handles 404 for missing item', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/index.docx', { id: null })
      .getChildren([{
        id: 'document-id',
        lastModifiedDateTime: 'Thu, 08 Jul 2021 10:04:16 GMT',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        name: 'other.docx',
        size: 3956,
      }]);

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });

  it('Handles unexpected exit from word2md', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/index.docx', { size: 3956 });

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--word2md%3Av7/invocations')
      .reply(200, {
        errorType: 'Runtime.ExitError',
        errorMessage: 'RequestId: d42a42f2-9886-4ec7-8e1d-69ee7086c66a Error: Runtime exited with error: signal: killed',
      }, {
        'x-amz-function-error': 'Unhandled',
      });

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/index.md\' from \'word2md\': {"errorType":"Runtime.ExitError","errorMessage":"RequestId: d42a42f2-9886-4ec7-8e1d-69ee7086c66a Error: Runtime exited with error: signal: killed"}');
  });

  it('Passes maxImageSize limits to word2md', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/index.docx', { size: 3956 });

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--word2md%3Av7/invocations')
      .reply((_, requestBody) => {
        const params = new URLSearchParams(JSON.parse(requestBody).rawQueryString);
        assert.deepStrictEqual(Object.fromEntries(params.entries()), {
          ...DEFAULT_BODY,
          maxImageSize: '100',
        });
        return [200, JSON.stringify({
          statusCode: 200,
          headers: {
            'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
          },
          body: '# hello, world!',
        })];
      });

    const { request, context } = setupTest('/', {
      config: {
        ...SITE_1D_CONFIG,
        limits: { preview: { maxImageSize: 100 } },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
  });

  it('Returns conflict from word2md when image too large', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getDocument('/index.docx', { size: 3956 });

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--word2md%3Av7/invocations')
      .reply(200, {
        statusCode: 409,
        headers: {
          'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
          'x-error': 'Image 1 exceeds allowed limit of 10.00MB',
        },
      });

    const { request, context } = setupTest('/', {
      config: {
        ...SITE_1D_CONFIG,
        limits: { preview: { maxImageSize: 100 } },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to preview '/index.md': source contains large image: Image 1 exceeds allowed limit of 10.00MB",
      'x-error-code': 'AEM_BACKEND_DOC_IMAGE_TOO_BIG',
      'x-source-location': 'onedrive:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
    });
  });
});
