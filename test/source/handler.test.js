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
/* eslint-disable no-param-reassign */
import assert from 'assert';
import { promisify } from 'util';
import zlib from 'zlib';
import { Headers, Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';

const gunzip = promisify(zlib.gunzip);

function assertHeadersInclude(headers, expected) {
  const actual = headers.plain();
  Object.entries(expected).forEach(([key, value]) => {
    assert.strictEqual(actual[key], value, `Expected header ${key} to be ${value}`);
  });
}

describe('Source Handler Tests', () => {
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

  function setupContext(suffix, { attributes } = {}) {
    return {
      attributes: {
        authInfo: new AuthInfo().withAuthenticated(true),
        ...attributes,
      },
      env: {
        HELIX_STORAGE_DISABLE_R2: 'true',
      },
      pathInfo: { suffix },
    };
  }

  it('handles GET requests', async () => {
    nock.source()
      .getObject('/org/site/hello.html')
      .reply(200, Buffer.from('<body>Hello, world!</body>'), {
        'content-type': 'text/html',
        'content-length': '26',
        'last-modified': new Date(946684800000).toUTCString(), // RFC HTTP date format!
        ETag: '"some-etag-327"',
        'x-amz-meta-id': 'dc0b68d8-b3ac-4c8a-9205-d78085e55704',
      });

    const headers = new Headers({ origin: 'https://example.com' });

    const resp = await main(new Request('https://api.aem.live/', {
      method: 'GET', headers,
    }), setupContext('/org/sites/site/source/hello.html'));
    assert.equal(resp.status, 200);
    const txt = await resp.text();
    assert.equal(txt, '<body>Hello, world!</body>');

    assertHeadersInclude(resp.headers, {
      'content-type': 'text/html',
      'content-length': '26',
      'last-modified': 'Sat, 01 Jan 2000 00:00:00 GMT',
      etag: '"some-etag-327"',
      'x-da-id': 'dc0b68d8-b3ac-4c8a-9205-d78085e55704',
      'access-control-allow-origin': 'https://example.com',
      'access-control-expose-headers': 'x-da-id, x-error, x-error-code',
    });
  });

  it('handles HEAD requests', async () => {
    nock.source()
      .headObject('/org/site/hellothere.html')
      .reply(200, null, {
        'content-type': 'text/html',
        'last-modified': new Date(999999999999).toUTCString(),
        'x-amz-meta-id': '12345',
      });

    const resp = await main(new Request('https://api.aem.live/', {
      method: 'HEAD',
    }), setupContext('/org/sites/site/source/hellothere.html'));
    assert.equal(resp.status, 200);
    assertHeadersInclude(resp.headers, {
      'content-type': 'text/html',
      'x-da-id': '12345',
      'last-modified': 'Sun, 09 Sep 2001 01:46:39 GMT',
    });
  });

  it('handles PUT requests', async () => {
    let assignedID = null;
    async function putFn(_uri, gzipBody) {
      assignedID = this.req.headers['x-amz-meta-id'];
      const b = await gunzip(Buffer.from(gzipBody, 'hex'));
      assert.equal(b.toString(), '<body><main>Yo!</main></body>');
    }

    nock.source()
      .putObject('/org/site/a/b/c.html')
      .matchHeader('x-amz-meta-users', '[{"email":"anonymous"}]')
      .reply(201, putFn);

    const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const resp = await main(new Request('https://api.aem.live/', {
      method: 'PUT',
      body: new URLSearchParams({
        data: '<body><main>Yo!</main></body>',
      }).toString(),
      headers,
    }), setupContext('/org/sites/site/source/a/b/c.html'));
    assert.equal(resp.status, 201);
    assert.equal(assignedID, resp.headers.get('X-da-id'));
  });

  it('handles unsupported method requests', async () => {
    const resp = await main(new Request('https://api.aem.live/', {
      method: 'POST',
    }), setupContext('/org/sites/site/source/x.html'));
    assert.equal(resp.status, 405);
  });

  it('handles getSource throws an error', async () => {
    const resp = await main(new Request('https://api.aem.live/', {
      method: 'GET',
    }), setupContext('/org/sites/site/source/qq.html', {
      attributes: {
        storage: {
          close: () => {},
          sourceBus: () => {
            const e = new Error('Test error');
            e.$metadata = { httpStatusCode: 505 };
            throw e;
          },
        },
      },
    }));
    assert.equal(resp.status, 505);
    assert.equal(resp.headers.get('x-error'), 'Test error');
  });
});
