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
import sourceHandler from '../../src/source/handler.js';

describe('Source Handler Tests', () => {
  it('handles GET requests', async () => {
    const mockBus = {
      get: async (path, meta) => {
        assert.equal(path, 'test/site/hello.html');
        meta.ContentType = 'text/html';
        meta.LastModified = new Date(946684800000);
        meta.ETag = '"some-etag-327"';
        meta.id = 'dc0b68d8-b3ac-4c8a-9205-d78085e55704';
        return '<body>Hello, world!</body>';
      },
    };
    const mockStorage = { sourceBus: () => mockBus };
    const context = { attributes: { storage: mockStorage } };
    const headers = new Headers({ origin: 'https://example.com' });
    const info = {
      method: 'GET',
      org: 'test',
      site: 'site',
      resourcePath: '/hello.html',
      headers,
    };
    const resp = await sourceHandler(context, info);
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), '<body>Hello, world!</body>');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/html',
      'content-length': '26',
      'last-modified': 'Sat, 01 Jan 2000 00:00:00 GMT',
      etag: '"some-etag-327"',
      'x-da-id': 'dc0b68d8-b3ac-4c8a-9205-d78085e55704',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'HEAD, GET, PUT, DELETE',
      'access-control-expose-headers': 'x-da-id',
    });
  });

  it('handles HEAD requests', async () => {
    const mockBus = {
      head: async (path) => {
        assert.equal(path, 'test/site/hellothere.html');
        return {
          $metadata: { httpStatusCode: 200 },
          ContentType: 'text/html',
          LastModified: new Date(999999999999),
          Metadata: {
            id: '12345',
          },
        };
      },
    };
    const mockStorage = { sourceBus: () => mockBus };
    const context = { attributes: { storage: mockStorage } };
    const info = {
      method: 'HEAD',
      org: 'test',
      site: 'site',
      resourcePath: '/hellothere.html',
      headers: new Headers(),
    };
    const resp = await sourceHandler(context, info);
    assert.equal(resp.status, 200);
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/html',
      'x-da-id': '12345',
      'last-modified': 'Sun, 09 Sep 2001 01:46:39 GMT',
    });
  });

  it('handles PUT requests', async () => {
    let storedId = null;
    const mockBus = {
      head: async () => null,
      put: async (path, body, mime, meta) => {
        storedId = meta.id;
        assert.equal(path, 'o/s/a/b/c.html');
        assert.equal(body, '<body><main>Yo!</main></body>');
        assert.equal(mime, 'text/html');
        assert(meta.id);
        assert.equal(meta.users, '[{"email":"anonymous"}]');
        return { $metadata: { httpStatusCode: 200 } };
      },
    };
    const mockStorage = { sourceBus: () => mockBus };
    const context = {
      attributes: {
        storage: mockStorage,
      },
      data: {
        data: '<body><main>Yo!</main></body>',
      },
    };
    const info = {
      method: 'PUT',
      org: 'o',
      site: 's',
      resourcePath: '/a/b/c.html',
      ext: '.html',
      headers: new Headers(),
    };
    const result = await sourceHandler(context, info);
    assert.equal(result.status, 201);
    assert.equal(result.headers.get('X-da-id'), storedId);
  });

  // add tests for the 2 error cases (unsupported method and getSource throws an error)
  it('handles unsupported method requests', async () => {
    const context = {};
    const info = {
      method: 'POST',
      headers: new Headers(),
    };
    const result = await sourceHandler(context, info);
    assert.equal(result.status, 405);
  });

  it('handles getSource throws an error', async () => {
    const context = { log: { error: () => {} } };
    const info = {
      method: 'GET',
      headers: new Headers(),
    };

    // Throws an error because context.attributes.storage is not set
    const result = await sourceHandler(context, info);
    assert.equal(result.status, 500);
  });

  it('handles putSource throws an error', async () => {
    const mockStorage = {
      sourceBus: () => {
        const e = new Error('Test error');
        e.$metadata = { httpStatusCode: 418 };
        throw e;
      },
    };

    const context = {
      attributes: { storage: mockStorage },
      log: { warn: () => {} },
    };
    const info = {
      method: 'PUT',
      headers: new Headers(),
    };

    // Throws an error because context.attributes.storage is not set
    const result = await sourceHandler(context, info);
    assert.equal(result.status, 418);
  });
});
