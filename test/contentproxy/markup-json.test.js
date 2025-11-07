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
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';
import { validSheet } from './utils.js';

const mountpointUrl = 'https://www.example.com';

const SITE_MUP_CONFIG = (url = `${mountpointUrl}/foo`) => ({
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

describe('Markup Integration Tests (JSON)', () => {
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
    config = SITE_MUP_CONFIG(),
    data, headers,
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

  it('Retrieves JSON from configured mountpoint url', async () => {
    const sheet = validSheet();
    const contentType = 'application/json; charset=utf-8';
    const lastModDate = new Date(0).toGMTString();

    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(200, sheet, {
        'content-type': contentType,
        'last-modified': lastModDate,
      });

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepEqual(await response.json(), sheet);
    assert.strictEqual(response.headers.get('x-source-location'), `${mountpointUrl}/foo/test.json`);
    assert.strictEqual(response.headers.get('content-type'), contentType);
    assert.strictEqual(response.headers.get('last-modified'), lastModDate);
  });

  it('Retrieves JSON from configured mountpoint url with auth header', async () => {
    const sheet = validSheet();
    const contentType = 'application/json; charset=utf-8';
    const lastModDate = new Date(0).toGMTString();

    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(function fn() {
        assert.strictEqual(this.req.headers.authorization, 'Basic 1234');
        assert.strictEqual(this.req.headers['x-content-source-location'], '/Index');
        return [200, sheet, {
          'content-type': contentType,
          'last-modified': lastModDate,
        }];
      });

    const { request, context } = setupTest('/test.json', {
      headers: {
        'x-content-source-authorization': 'Basic 1234',
        'x-content-source-location': '/Index',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepEqual(await response.json(), sheet);
    assert.strictEqual(response.headers.get('x-source-location'), `${mountpointUrl}/foo/test.json`);
    assert.strictEqual(response.headers.get('content-type'), contentType);
    assert.strictEqual(response.headers.get('last-modified'), lastModDate);
  });

  it('Handles mountpoint urls ending with /', async () => {
    const sheet = validSheet();

    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(200, sheet, { 'content-type': 'application/json' });

    const { request, context } = setupTest('/test.json', {
      config: SITE_MUP_CONFIG(`${mountpointUrl}/foo/`),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepEqual(await response.json(), sheet);
    assert.strictEqual(response.headers.get('x-source-location'), `${mountpointUrl}/foo/test.json`);
    assert.strictEqual(response.headers.get('content-type'), 'application/json');
  });

  it('Handles mountpoint urls containing consecutive /', async () => {
    const sheet = validSheet();

    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(200, sheet, { 'content-type': 'application/json' });

    const { request, context } = setupTest('/test.json', {
      config: SITE_MUP_CONFIG(`${mountpointUrl}//foo/`),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepEqual(await response.json(), sheet);
    assert.strictEqual(response.headers.get('x-source-location'), `${mountpointUrl}/foo/test.json`);
    assert.strictEqual(response.headers.get('content-type'), 'application/json');
  });

  it('Handles 304 not modified responses from mountpoint url', async () => {
    const lastModDate = new Date(0).toGMTString();

    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(304, null, { 'last-modified': lastModDate });

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 304);
    assert.strictEqual(response.headers.get('x-source-location'), `${mountpointUrl}/foo/test.json`);
    assert.strictEqual(response.headers.get('last-modified'), lastModDate);
  });

  it('Handles invalid JSON from mountpoint url', async () => {
    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(200, 'foo', { 'content-type': 'application/json' });

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.headers.get('x-error'), 'JSON fetched from markup \'/test.json\' is invalid: invalid sheet json; failed to parse');
  });

  it('Handles invalid sheet format from mountpoint url', async () => {
    const sheet = validSheet({ ':type': 'foo' });

    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(200, sheet, { 'content-type': 'application/json' });

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.headers.get('x-error'), 'JSON fetched from markup \'/test.json\' is invalid: invalid sheet; unknown type');
  });

  it('Handles timeout from mountpoint url', async () => {
    nock(mountpointUrl)
      .get('/foo/test.json')
      .delay(5)
      .reply(200);

    const { request, context } = setupTest('/test.json', {
      data: {
        fetchTimeout: 1,
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 504);
  });

  it('Falls back to code-bus resources if not found (404) from mountpoint', async () => {
    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(404);

    const sheet = validSheet();
    nock.code()
      .getObject('/test.json')
      .reply(200, sheet, { 'content-type': 'application/json' });

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepEqual(await response.json(), sheet);
    assert.strictEqual(response.headers.get('content-type'), 'application/json');
  });

  it('Falls back to code-bus resources if not found (403) from mountpoint', async () => {
    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(function fn() {
        assert.strictEqual(this.req.headers.authorization, 'Basic 1234');
        return [403];
      });

    const sheet = validSheet();
    nock.code()
      .getObject('/test.json')
      .reply(200, sheet, { 'content-type': 'application/json' });

    const { request, context } = setupTest('/test.json', {
      headers: {
        'x-content-source-authorization': 'Basic 1234',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepEqual(await response.json(), sheet);
    assert.strictEqual(response.headers.get('content-type'), 'application/json');
  });

  it('handles errors from origin', async () => {
    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(401);

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/test.json\' from \'markup\': (401)');
  });

  it('handles 500 from origin', async () => {
    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(500);

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(response.headers.raw(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to fetch \'/test.json\' from \'markup\': (500)',
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
      'x-severity': 'warn',
    });
  });

  it('Handles malformed URL in fstab', async () => {
    const { request, context } = setupTest('/test.json', {
      config: SITE_MUP_CONFIG('markup.example.com'),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/test.json\' from \'markup\': (400) - Bad mountpoint URL in fstab');
  });

  it('Handles invalid mountpoint url', async () => {
    nock(mountpointUrl)
      .get('/foo/test.json')
      .replyWithError('getaddrinfo ENOTFOUND https');

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to fetch \'/test.json\' from \'markup\': mountpoint URL invalid',
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
      'x-severity': 'warn',
    });
  });

  it('Handles resources missing from both mountpoint url & code-bus', async () => {
    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(404);

    nock.code()
      .getObject('/test.json')
      .reply(404);

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });

  it('Handles invalid JSON from code-bus', async () => {
    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(404);

    nock.code()
      .getObject('/test.json')
      .reply(200, 'foo', { 'content-type': 'application/json' });

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.headers.get('x-error'), 'JSON fetched from markup \'/test.json\' is invalid: invalid sheet json; failed to parse');
  });

  it('Handles invalid sheet format from code-bus', async () => {
    nock(mountpointUrl)
      .get('/foo/test.json')
      .reply(404);

    const sheet = validSheet({ ':type': 'foo' });
    nock.code()
      .getObject('/test.json')
      .reply(200, sheet, { 'content-type': 'application/json' });

    const { request, context } = setupTest('/test.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.headers.get('x-error'), 'JSON fetched from markup \'/test.json\' is invalid: invalid sheet; unknown type');
  });

  it('Passes query params from mountpoint url', async () => {
    const sheet = validSheet();
    nock(mountpointUrl)
      .get('/foo/test.json')
      .query({ baz: 'true' })
      .reply((pathname) => {
        assert.equal(pathname, '/foo/test.json?baz=true');
        return [200, sheet, { 'content-type': 'application/json' }];
      });

    const { request, context } = setupTest('/test.json', {
      config: SITE_MUP_CONFIG(`${mountpointUrl}/foo?baz=true`),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
  });

  it('Returns 400 for an internal host', async () => {
    const { request, context } = setupTest('/test.json', {
      config: SITE_MUP_CONFIG('https://127.0.0.1:8443/'),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
  });

  // TODO: add when bulk is operative

  // describe('bulk preview', () => {
  //   it('updates size in sourceInfo on success', async () => {
  //     const sheet = validSheet();
  //     nock(mountpointUrl)
  //       .get('/foo/test.json')
  //       .reply(200, sheet, { 'content-type': 'application/json', 'content-length': '123' });

  //     const context = await TEST_CONTEXT();
  //     const mp = context.attributes.mountConfig.match('/test.json');
  //     const opts = {
  //       ...DEFAULT_PARAMS,
  //       mp,
  //       resourcePath: '/test.json',
  //       ext: '.json',
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
  //       .get('/foo/test.json')
  //       .reply(401);

  //     const context = await TEST_CONTEXT();
  //     const mp = context.attributes.mountConfig.match('/test.json');
  //     const opts = {
  //       ...DEFAULT_PARAMS,
  //       mp,
  //       resourcePath: '/test.json',
  //       ext: '.json',
  //       sourceInfo: {
  //         size: 1,
  //         lastModified: 1,
  //       },
  //     };
  //     const response = await contentProxy(context, opts);
  //     assert.strictEqual(response.status, 401);
  //     assert.strictEqual(opts.sourceInfo.size, undefined);
  //     assert.strictEqual(opts.sourceInfo.lastModified, undefined);
  //   });
  // });
});
