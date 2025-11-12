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
        meta.timestamp = '946684800000';
        meta.ETag = '"some-etag-327"';
        meta.id = 'dc0b68d8-b3ac-4c8a-9205-d78085e55704';
        return '<body>Hello, world!</body>';
      },
    };
    const mockStorage = { sourceBus: () => mockBus };
    const context = { attributes: { storage: mockStorage } };
    const info = {
      method: 'GET',
      org: 'test',
      site: 'site',
      resourcePath: '/hello.html',
    };
    const result = await sourceHandler(context, info);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), '<body>Hello, world!</body>');
    assert.equal(result.headers.get('Content-Type'), 'text/html');
    assert.equal(result.headers.get('Content-Length'), '26');
    assert.equal(result.headers.get('Last-Modified'), 'Sat, 01 Jan 2000 00:00:00 GMT');
    assert.equal(result.headers.get('ETag'), '"some-etag-327"');
    assert.equal(result.headers.get('X-da-id'), 'dc0b68d8-b3ac-4c8a-9205-d78085e55704');
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(result.headers.get('Access-Control-Allow-Headers'), '*');
    assert.equal(result.headers.get('Access-Control-Allow-Methods'), 'HEAD, GET, PUT, DELETE');
    assert.equal(result.headers.get('Access-Control-Expose-Headers'), 'X-da-id');
  });

  it('handles HEAD requests', async () => {
    const mockBus = {
      head: async (path) => {
        assert.equal(path, 'test/site/hellothere.html');
        return {
          $metadata: { httpStatusCode: 200 },
          ContentType: 'text/html',
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
    };
    const result = await sourceHandler(context, info);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Content-Type'), 'text/html');
    assert.equal(result.headers.get('X-da-id'), '12345');
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(result.headers.get('Access-Control-Allow-Headers'), '*');
    assert.equal(result.headers.get('Access-Control-Allow-Methods'), 'HEAD, GET, PUT, DELETE');
    assert.equal(result.headers.get('Access-Control-Expose-Headers'), 'X-da-id');
    assert.equal(result.headers.get('ETag'), null, 'ETag header should not be set');
    assert.equal(result.headers.get('Last-Modified'), null, 'Last-Modified header should not be set');
  });

  it('handles PUT requests', async () => {
    const mockBus = {
      put: async (path, body, mime, meta) => {
        assert.equal(path, 'o/s/a/b/c.html');
        assert.equal(body, '<body><main>Yo!</main></body>');
        assert.equal(mime, 'text/html');
        assert(meta.timestamp);
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
    };
    const result = await sourceHandler(context, info);
    assert.equal(result.status, 201);
    assert(result.headers.get('X-da-id'), 'X-da-id header should be set');
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(result.headers.get('Access-Control-Allow-Headers'), '*');
    assert.equal(result.headers.get('Access-Control-Allow-Methods'), 'HEAD, GET, PUT, DELETE');
    assert.equal(result.headers.get('Access-Control-Expose-Headers'), 'X-da-id');
  });

  // add tests for the 2 error cases (unsupported method and getSource throws an error)
  it('handles unsupported method requests', async () => {
    const context = {};
    const info = {
      method: 'POST',
    };
    const result = await sourceHandler(context, info);
    assert.equal(result.status, 405);
  });

  it('handles getSource throws an error', async () => {
    const context = {};
    const info = {
      method: 'GET',
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

    const context = { attributes: { storage: mockStorage } };
    const info = { method: 'PUT' };

    // Throws an error because context.attributes.storage is not set
    const result = await sourceHandler(context, info);
    assert.equal(result.status, 418);
  });
});
