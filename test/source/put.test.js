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
import { putSource } from '../../src/source/put.js';

describe('Source PUT Tests', () => {
  it('test putSource with existing resource (has ID)', async () => {
    const context = {
      data: { data: '<html><body>Hello</body></html>' },
    };

    let headCalled = false;
    let putCalled = false;

    const mockHead = async (path) => {
      headCalled = true;
      assert.equal(path, 'test/rest/toast/jam.html');
      return {
        $metadata: { httpStatusCode: 200 },
        ContentType: 'text/html',
        ContentLength: 100,
        ETag: 'test-etag',
        LastModified: new Date(999999999999),
        Metadata: {
          id: 'existing-id-123',
        },
      };
    };

    const mockPut = async (path, body, contentType, metadata) => {
      putCalled = true;
      assert.equal(path, 'test/rest/toast/jam.html');
      assert.equal(body, '<html><body>Hello</body></html>');
      assert.equal(contentType, 'text/html');
      assert.equal(metadata.id, 'existing-id-123');
      assert.equal(metadata.users, '[{"email":"anonymous"}]');
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'rest',
      resourcePath: '/toast/jam.html',
      ext: '.html',
    };

    const resp = await putSource({ context, info });
    assert.ok(headCalled, 'head should have been called');
    assert.ok(putCalled, 'put should have been called');
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('x-da-id'), 'existing-id-123');
  });

  it('test putSource with new resource (generates new ID)', async () => {
    const context = {
      data: { data: '{"something":"else"}' },
    };

    let generatedId;

    const mockHead = async (path) => {
      assert.equal(path, 'myorg/mysite/data/test.json');
      return null; // Resource doesn't exist
    };

    const mockPut = async (path, body, contentType, metadata) => {
      assert.equal(path, 'myorg/mysite/data/test.json');
      assert.equal(body, '{"something":"else"}');
      assert.equal(contentType, 'application/json');
      assert.ok(metadata.id);
      generatedId = metadata.id;
      // Verify UUID format (basic check)
      assert.match(metadata.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'myorg',
      site: 'mysite',
      resourcePath: '/data/test.json',
      ext: '.json',
    };

    const resp = await putSource({ context, info });
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('x-da-id'), generatedId);
  });

  it('test putSource with unknown file extension returns 400', async () => {
    const context = {
      data: { data: 'Binary content' },
      log: { warn: () => {} },
    };

    const mockHead = async () => null;

    const mockPut = async () => {
      throw new Error('Should not be called');
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/file.bin',
      ext: '.bin',
    };

    const resp = await putSource({ context, info });
    assert.equal(resp.status, 400);
  });

  it('test putSource handles bucket.put error with metadata', async () => {
    const context = {
      data: { data: 'Content' },
      log: { warn: () => {} },
    };

    const mockHead = async () => ({
      $metadata: { httpStatusCode: 200 },
      ContentType: 'text/html',
      ContentLength: 100,
      ETag: 'test-etag',
      LastModified: new Date(),
      Metadata: {
        id: 'test-id',
      },
    });

    const mockPut = async () => {
      const error = new Error('S3 Error');
      error.$metadata = { httpStatusCode: 403 };
      throw error;
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/test.html',
      ext: '.html',
    };

    const resp = await putSource({ context, info });
    assert.equal(resp.status, 403);
  });

  it('test putSource handles bucket.put error without metadata', async () => {
    const context = {
      data: { data: 'Content' },
      log: { error: () => {} },
    };

    const mockHead = async () => ({
      $metadata: { httpStatusCode: 200 },
      ContentType: 'text/html',
      ContentLength: 100,
      ETag: 'test-etag',
      LastModified: new Date(),
      Metadata: {
        id: 'test-id-500',
      },
    });

    const mockPut = async () => {
      throw new Error('Unknown error');
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/test.html',
      ext: '.html',
    };

    const resp = await putSource({ context, info });
    assert.equal(resp.status, 500);
  });

  it('test putSource with matching guid succeeds', async () => {
    const context = {
      data: {
        data: 'Updated content',
        guid: 'existing-id-123',
      },
    };

    const mockHead = async () => ({
      $metadata: { httpStatusCode: 200 },
      ContentType: 'text/html',
      ContentLength: 100,
      ETag: 'test-etag',
      LastModified: new Date(),
      Metadata: {
        id: 'existing-id-123',
      },
    });

    const mockPut = async (path, body, contentType, metadata) => {
      assert.equal(body, 'Updated content');
      assert.equal(metadata.id, 'existing-id-123');
      return { $metadata: { httpStatusCode: 204 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };
    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/test.html',
      ext: '.html',
    };

    const resp = await putSource({ context, info });
    assert.equal(resp.status, 204);
    assert.equal(resp.headers.get('x-da-id'), 'existing-id-123');
  });

  it('test putSource with mismatched guid returns 409', async () => {
    const context = {
      data: {
        data: 'Updated content',
        guid: 'wrong-id',
      },
    };

    const mockHead = async () => ({
      $metadata: { httpStatusCode: 200 },
      ContentType: 'text/html',
      ContentLength: 100,
      ETag: 'test-etag',
      LastModified: new Date(),
      Metadata: {
        id: 'existing-id-123',
      },
    });

    const mockPut = async () => {
      assert.fail('PUT should not be called when ID mismatch');
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/test.html',
      ext: '.html',
    };

    const resp = await putSource({ context, info });
    assert.equal(resp.status, 409);
    const text = await resp.text();
    assert.ok(text.includes('ID mismatch'));
  });

  it('test putSource with guid for new resource uses the provided guid', async () => {
    const context = {
      attributes: {
        authInfo: {
          profile: {
            email: 'test@example.com',
            user_id: 'user-123.e',
          },
        },
      },
      data: {
        data: 'New content',
        guid: 'provided-id-456',
      },
    };

    const mockHead = async () => null; // Resource doesn't exist

    const mockPut = async (path, body, contentType, metadata) => {
      assert.equal(body, 'New content');
      // Should use the provided guid
      assert.equal(metadata.id, 'provided-id-456');
      assert.equal(metadata.users, '[{"email":"test@example.com","user_id":"user-123.e"}]');
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes.storage = mockS3Storage;

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/new.html',
      ext: '.html',
    };

    const resp = await putSource({ context, info });
    // When guid is provided for non-existent resource, it uses the provided guid
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('x-da-id'), 'provided-id-456');
  });
});
