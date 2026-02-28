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
import { gzip } from 'zlib';
import { promisify } from 'util';
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

const gzipAsync = promisify(gzip);

const SITE_MUP_CONFIG = (url = 'https://www.example.com') => ({
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'markup',
      url,
      suffix: '.semantic.html',
    },
  },
});

const DEFAULT_BODY = {
  contentBusId: SITE_MUP_CONFIG().content.contentBusId,
  owner: 'org',
  repo: 'site',
  org: 'org',
  site: 'site',
  ref: 'main',
  rid: 'rid',
  mediaBucket: 'helix-media-bus',
  sourceUrl: 'https://www.example.com/index.semantic.html',
};

describe('Markup Integration Tests', () => {
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
    headers = { 'x-content-source-authorization': 'Bearer dummy-access-token' },
    authInfo = AuthInfo.Default().withAuthenticated(true),
  } = {}) {
    nock.siteConfig(config);

    const suffix = `/org/sites/site/contentproxy${path}`;
    const query = new URLSearchParams(data);

    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      headers: {
        'x-request-id': 'rid',
        ...headers,
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

  it('Retrieves Document via html2md', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply((_, requestBody) => {
        const { headers, body } = JSON.parse(requestBody);
        assert.deepStrictEqual(JSON.parse(body), {
          ...DEFAULT_BODY,
          features: {
            unspreadLists: true,
          },
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

    const { request, context } = setupTest('/', {
      config: {
        ...SITE_MUP_CONFIG(),
        features: {
          html2md: {
            unspreadLists: true,
          },
        },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
    assert.strictEqual(response.headers.get('x-source-location'), 'markup:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE');
  });

  it('Retrieves Document via html2md with gzip content-encoding', async () => {
    const svcBody = await gzipAsync(JSON.stringify({
      markdown: '# hello, world!',
      media: [],
    }));
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply((_, requestBody) => {
        const { headers, body } = JSON.parse(requestBody);
        assert.deepStrictEqual(JSON.parse(body), {
          ...DEFAULT_BODY,
          features: {
            unspreadLists: true,
          },
        });
        assert.strictEqual(headers.authorization, 'Bearer dummy-access-token');
        return [200, JSON.stringify({
          statusCode: 200,
          headers: {
            'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
            'content-type': 'application/json',
            'content-encoding': 'gzip',
          },
          isBase64Encoded: true,
          body: svcBody.toString('base64'),
        })];
      });

    const { request, context } = setupTest('/', {
      config: {
        ...SITE_MUP_CONFIG(),
        features: {
          html2md: {
            unspreadLists: true,
          },
        },
      },
    });
    const response = await main(request, context);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
    assert.strictEqual(response.headers.get('content-length'), '15');
    assert.strictEqual(response.headers.get('x-source-location'), 'markup:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE');
  });

  it('Retrieves Document via html2md from a DA with embedded IMS token', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply((_, requestBody) => {
        const { headers, body } = JSON.parse(requestBody);
        assert.deepStrictEqual(JSON.parse(body), {
          ...DEFAULT_BODY,
          sourceUrl: 'https://content.da.live/org/site/index.semantic.html',
        });
        assert.strictEqual(headers.authorization, 'Bearer ims-token');
        return [200, JSON.stringify({
          statusCode: 200,
          headers: {
            'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
          },
          body: '# hello, world!',
        })];
      });

    const { request, context } = setupTest('/', {
      config: SITE_MUP_CONFIG('https://content.da.live/org/site/'),
      authInfo: AuthInfo.Default()
        .withAuthenticated(true)
        .withImsToken('ims-token'),
      headers: {},
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
    assert.strictEqual(response.headers.get('x-source-location'), 'markup:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE');
  });

  it('Retrieves Document via html2md from a AEMCS with embedded IMS token', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply((_, requestBody) => {
        const { headers, body } = JSON.parse(requestBody);
        assert.deepStrictEqual(JSON.parse(body), {
          ...DEFAULT_BODY,
          sourceUrl: 'https://author-p123-e123.adobeaemcloud.com/bin/franklin.delivery/org/site/main/index.semantic.html',
        });
        assert.strictEqual(headers.authorization, 'Bearer ims-token');
        return [200, JSON.stringify({
          statusCode: 200,
          headers: {
            'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
          },
          body: '# hello, world!',
        })];
      });

    const { request, context } = setupTest('/', {
      config: SITE_MUP_CONFIG('https://author-p123-e123.adobeaemcloud.com/bin/franklin.delivery/org/site/main/'),
      authInfo: AuthInfo.Default()
        .withAuthenticated(true)
        .withImsToken('ims-token'),
      headers: {},
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
    assert.strictEqual(response.headers.get('x-source-location'), 'markup:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE');
  });

  it('Passes limits to html2md', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply((_, requestBody) => {
        const { headers, body } = JSON.parse(requestBody);
        assert.deepStrictEqual(JSON.parse(body), {
          ...DEFAULT_BODY,
          limits: {
            maxImages: 300,
          },
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

    const { request, context } = setupTest('/', {
      config: {
        ...SITE_MUP_CONFIG(),
        limits: {
          html2md: {
            maxImages: 300,
          },
        },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
    assert.strictEqual(response.headers.get('x-source-location'), 'markup:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE');
  });

  it('Passes maxImageSize limits to html2md', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply((_, requestBody) => {
        const { headers, body } = JSON.parse(requestBody);
        assert.deepStrictEqual(JSON.parse(body), {
          ...DEFAULT_BODY,
          limits: {
            maxImageSize: 100,
          },
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

    const { request, context } = setupTest('/', {
      config: {
        ...SITE_MUP_CONFIG(),
        limits: {
          preview: {
            maxImageSize: 100,
          },
        },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
    assert.strictEqual(response.headers.get('x-source-location'), 'markup:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE');
  });

  it('Retrieves Document via html2md with selected version', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Aci123/invocations')
      .reply(200, JSON.stringify({
        statusCode: 200,
        headers: {},
        body: '# hello, world!',
      }));

    const { request, context } = setupTest('/', {
      data: {
        'hlx-html2md-version': 'ci123',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
  });

  it('Handles malformed URL in fstab', async () => {
    const { request, context } = setupTest('/', {
      config: SITE_MUP_CONFIG('markup.example.com'),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/index.md\' from \'markup\': (400) - Bad mountpoint URL in fstab');
  });

  it('Handles generic error from Lambda', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply(500, {
        Message: 'That request was too large.',
      }, {
        'x-amzn-errortype': 'RequestTooLargeException',
      });

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/index.md\' from \'html2md\': That request was too large.');
  });

  it('Handles error response from Lambda and propagates severity', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply(200, JSON.stringify({
        statusCode: 504,
        headers: {
          'x-error': 'error fetching resource at https://www.example.com/: timeout after 10s',
          'content-type': 'text/plain; charset=utf-8',
          'x-severity': 'warn',
        },
        multiValueHeaders: {},
        isBase64Encoded: false,
        body: '',
      }), {
        'content-type': 'application/json',
      });

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 504);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to fetch \'/index.md\' from \'html2md\': (504) - error fetching resource at https://www.example.com/: timeout after 10s',
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
      'x-severity': 'warn',
      'x-source-location': 'markup:undefined',
    });
  });

  it('Handles 429s from html2md and propagates severity', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply(200, JSON.stringify({
        statusCode: 429,
        headers: {
          'x-error': 'error fetching resource at https://www.example.com/',
          'content-type': 'text/plain; charset=utf-8',
        },
        multiValueHeaders: {},
        isBase64Encoded: false,
        body: '',
      }), {
        'content-type': 'application/json',
      });

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 503);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to fetch \'/index.md\' from \'html2md\': (429) - error fetching resource at https://www.example.com/',
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
      'x-severity': 'warn',
      'x-source-location': 'markup:undefined',
    });
  });

  it('Handles error with default function version from Lambda', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply(500, {
        Message: 'Function not found: arn:aws:lambda:us-east-1:123456789012:function:helix3--html2md:v2.',
      }, {
        'x-amzn-errortype': 'ResourceNotFoundException',
      });

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/index.md\' from \'html2md\': function not found');
  });

  it('Handles error with custom function version from Lambda', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Afoo/invocations')
      .reply(500, {
        Message: 'Function not found: arn:aws:lambda:us-east-1:123456789012:function:helix3--html2md:foo.',
      }, {
        'x-amzn-errortype': 'ResourceNotFoundException',
      });

    const { request, context } = setupTest('/', {
      data: {
        'hlx-html2md-version': 'foo',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/index.md\' from \'html2md\': function not found');
  });

  it('Passes query params from mountpoint url to html2md', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply((_, requestBody) => {
        const { body } = JSON.parse(requestBody);
        assert.deepStrictEqual(JSON.parse(body), {
          ...DEFAULT_BODY,
          sourceUrl: 'https://www.example.com/foo/index.semantic.html?baz=true',
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
      config: SITE_MUP_CONFIG('https://www.example.com/foo?baz=true'),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
  });

  it('passes x-content-source-location header', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply((_, requestBody) => {
        const { headers } = JSON.parse(requestBody);
        assert.strictEqual(headers['x-content-source-location'], '/content/my_site/Foo_Bar/index');
        return [200, JSON.stringify({
          statusCode: 200,
          headers: {
            'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
          },
          body: '# hello, world!',
        })];
      });

    const { request, context } = setupTest('/', {
      config: SITE_MUP_CONFIG('https://www.example.com/foo?baz=true'),
      headers: {
        authorization: 'Bearer dummy-access-token',
        'x-content-source-location': '/content/my_site/Foo_Bar/index',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
  });

  it('passes x-content-source-location header from rawPath', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply((_, requestBody) => {
        const { headers } = JSON.parse(requestBody);
        assert.strictEqual(headers['x-content-source-location'], '/Foo_Bar/');
        return [200, JSON.stringify({
          statusCode: 200,
          headers: {
            'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
          },
          body: '# hello, world!',
        })];
      });

    const { request, context } = setupTest('/Foo_Bar/', {
      config: SITE_MUP_CONFIG('https://www.example.com/foo?baz=true'),
      headers: {
        'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
  });

  it('does not pass authorization header to html2md', async () => {
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--html2md%3Av2/invocations')
      .reply((_, requestBody) => {
        const { headers } = JSON.parse(requestBody);
        assert.ok(!headers.authorization);
        return [200, JSON.stringify({
          statusCode: 200,
          headers: {
            'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
          },
          body: '# hello, world!',
        })];
      });

    const { request, context } = setupTest('/', {
      config: SITE_MUP_CONFIG('https://www.example.com/foo?baz=true'),
      headers: {
        authorization: 'Bearer correct-token',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# hello, world!');
  });
});
