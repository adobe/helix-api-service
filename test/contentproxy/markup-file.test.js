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
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';

const mountpointUrl = 'https://www.example.com';

const SITE_MUP_CONFIG = (url = `${mountpointUrl}/foo`) => ({
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'markup',
      url,
      suffix: '.html',
    },
  },
});

describe('Markup File Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.orgConfig(ORG_CONFIG);
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

    const request = new Request(`https://localhost${suffix}?${query}`, {
      headers: {
        'x-request-id': 'rid',
        ...headers,
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo,
      },
      runtime: { region: 'us-east-1' },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    };
    return { request, context };
  }

  it('Retrieves pdf from configured mountpoint url', async () => {
    nock(mountpointUrl)
      .get('/foo/bar.pdf')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/empty.pdf'), {
        'content-type': 'application/pdf',
      });

    const { request, context } = setupTest('/bar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'application/pdf');
    assert.strictEqual(response.headers.get('x-source-location'), `${mountpointUrl}/foo/bar.pdf`);
  });

  it('Handles mountpoint url ending with /', async () => {
    nock(mountpointUrl)
      .get('/foo/bar.pdf')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/empty.pdf'), {
        'content-type': 'application/pdf',
      });

    const { request, context } = setupTest('/bar.pdf', {
      config: SITE_MUP_CONFIG(`${mountpointUrl}/foo/`),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'application/pdf');
    assert.strictEqual(response.headers.get('x-source-location'), `${mountpointUrl}/foo/bar.pdf`);
  });

  it('Retrieves pdf from configured mountpoint url with auth header', async () => {
    const contentType = 'application/pdf';
    const lastModDate = new Date(0).toGMTString();
    const pdf = readFileSync(resolve(__testdir, 'contentproxy/fixtures/empty.pdf'), 'utf8');
    nock(mountpointUrl)
      .get('/foo/bar.pdf')
      .reply(function fn() {
        assert.strictEqual(this.req.headers.authorization, 'Basic 1234');
        assert.strictEqual(this.req.headers['x-content-source-location'], '/Bar.pdf');
        return [200, pdf, {
          'content-type': contentType,
          'last-modified': lastModDate,
        }];
      });

    const { request, context } = setupTest('/bar.pdf', {
      headers: {
        'x-content-source-authorization': 'Basic 1234',
        'x-content-source-location': '/Bar.pdf',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'application/pdf');
    assert.strictEqual(response.headers.get('x-source-location'), `${mountpointUrl}/foo/bar.pdf`);
  });

  it('Handles unsupported media type when no content-type header is set', async () => {
    nock(mountpointUrl)
      .get('/foo/bar.pdf')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/empty.pdf'));

    const { request, context } = setupTest('/bar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 415);
    assert.strictEqual(response.headers.get('x-error'), 'Content type header is missing');
    assert.strictEqual(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  });

  it('Handles 304 not modified responses from mountpoint url', async () => {
    const lastModDate = new Date(0).toGMTString();
    nock(mountpointUrl)
      .get('/foo/bar.pdf')
      .reply(304, null, { 'last-modified': lastModDate });

    const { request, context } = setupTest('/bar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 304);
    assert.strictEqual(response.headers.get('x-source-location'), `${mountpointUrl}/foo/bar.pdf`);
    assert.strictEqual(response.headers.get('last-modified'), lastModDate);
  });

  it('Handles bad responses from mountpoint url', async () => {
    const lastModDate = new Date(0).toGMTString();
    nock(mountpointUrl)
      .get('/foo/bar.pdf')
      .reply(400, null, { 'last-modified': lastModDate });

    const { request, context } = setupTest('/bar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to fetch \'/bar.pdf\' from \'markup\': (400)',
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
      'x-severity': 'warn',
    });
  });

  it('Handles malformed URL in fstab', async () => {
    const { request, context } = setupTest('/bar.pdf', {
      config: SITE_MUP_CONFIG('markup.example.com'),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/bar.pdf\' from \'markup\': (400) - Bad mountpoint URL in fstab');
  });

  it('Handles invalid mountpoint url', async () => {
    nock(mountpointUrl)
      .get('/foo/bar.pdf')
      .replyWithError('getaddrinfo ENOTFOUND https');

    const { request, context } = setupTest('/bar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to fetch \'/bar.pdf\' from \'markup\': mountpoint URL invalid',
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
      'x-severity': 'warn',
    });
  });

  it('Handles timeout from mountpoint url', async () => {
    nock(mountpointUrl)
      .get('/foo/bar.pdf')
      .delay(10)
      .reply(200);

    const { request, context } = setupTest('/bar.pdf', {
      data: {
        fetchTimeout: 1,
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 504);
  });

  it('Handles file missing from configured mountpoint url', async () => {
    nock(mountpointUrl)
      .get('/foo/bar.pdf')
      .reply(404);

    const { request, context } = setupTest('/bar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });

  it('Passes query params from mountpoint url', async () => {
    nock(mountpointUrl)
      .get('/foo/bar.pdf')
      .query({ baz: 'true' })
      .reply((pathname) => {
        assert.equal(pathname, '/foo/bar.pdf?baz=true');
        return [404];
      });

    const { request, context } = setupTest('/bar.pdf', {
      config: SITE_MUP_CONFIG(`${mountpointUrl}/foo?baz=true`),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });

  it('Returns 400 for an internal host', async () => {
    const { request, context } = setupTest('/bar.pdf', {
      config: SITE_MUP_CONFIG('https://localhost:8443/'),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
  });

  // TODO: add when bulk is operative

  // describe('bulk preview', () => {
  //   it('updates size in sourceInfo on success', async () => {
  //     nock(mountpointUrl)
  //       .get('/foo/bar.pdf')
  //       .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/empty.pdf'), {
  //         'content-type': 'application/pdf',
  //         'content-length': '123',
  //       });

  //     const context = await TEST_CONTEXT();
  //     const mp = context.attributes.mountConfig.match('/bar.pdf');
  //     const opts = {
  //       ...DEFAULT_PARAMS,
  //       mp,
  //       resourcePath: '/bar.pdf',
  //       ext: '.pdf',
  //       sourceInfo: {
  //         size: 1,
  //       },
  //     };
  //     const response = await contentProxy(context, opts);
  //     assert.strictEqual(response.status, 200);
  //     assert.strictEqual(opts.sourceInfo.size, 123);
  //   });

  //   it('removes size and lastModified in sourceInfo on fetch failure', async () => {
  //     nock(mountpointUrl)
  //       .get('/foo/bar.pdf')
  //       .reply(404);

  //     const context = await TEST_CONTEXT();
  //     const mp = context.attributes.mountConfig.match('/bar.pdf');
  //     const opts = {
  //       ...DEFAULT_PARAMS,
  //       mp,
  //       resourcePath: '/bar.pdf',
  //       ext: '.pdf',
  //       sourceInfo: {
  //         size: 1,
  //         lastModified: 1,
  //       },
  //     };
  //     const response = await contentProxy(context, opts);
  //     assert.strictEqual(response.status, 404);
  //     assert.strictEqual(opts.sourceInfo.size, undefined);
  //     assert.strictEqual(opts.sourceInfo.lastModified, undefined);
  //   });
  // });
});
