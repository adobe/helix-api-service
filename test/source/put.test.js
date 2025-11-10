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
      data: { data: 'Updated content' },
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
        Metadata: {
          timestamp: '12345',
          id: 'existing-id-123',
        },
      };
    };

    const mockPut = async (path, body, contentType, metadata) => {
      putCalled = true;
      assert.equal(path, 'test/rest/toast/jam.html');
      assert.equal(body, 'Updated content');
      assert.equal(contentType, 'text/html');
      assert.equal(metadata.id, 'existing-id-123');
      assert.ok(metadata.timestamp);
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'test',
      site: 'rest',
      resourcePath: '/toast/jam.html',
      ext: '.html',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.ok(headCalled, 'head should have been called');
    assert.ok(putCalled, 'put should have been called');
    assert.equal(result.status, 200);
    assert.equal(result.metadata.id, 'existing-id-123');
  });

  it('test putSource with new resource (generates new ID)', async () => {
    const context = {
      data: { data: 'New content' },
    };

    let generatedId;

    const mockHead = async (path) => {
      assert.equal(path, 'myorg/mysite/data/test.json');
      return null; // Resource doesn't exist
    };

    const mockPut = async (path, body, contentType, metadata) => {
      assert.equal(path, 'myorg/mysite/data/test.json');
      assert.equal(body, 'New content');
      assert.equal(contentType, 'application/json');
      assert.ok(metadata.id);
      generatedId = metadata.id;
      // Verify UUID format (basic check)
      assert.match(metadata.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.ok(metadata.timestamp);
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'myorg',
      site: 'mysite',
      resourcePath: '/data/test.json',
      ext: '.json',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.equal(result.status, 200);
    assert.equal(result.metadata.id, generatedId);
  });

  it('test putSource with unknown file extension returns 400', async () => {
    const context = {
      data: { data: 'Binary content' },
    };

    const mockHead = async () => null;

    const mockPut = async (_path, _body, contentType) => {
      assert.equal(contentType, 'application/octet-stream');
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/file.bin',
      ext: '.bin',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.equal(result.status, 400);
    assert.ok(result.metadata.id);
  });

  it('test putSource handles bucket.put error with metadata', async () => {
    const context = {
      data: { data: 'Content' },
    };

    const mockHead = async () => ({
      $metadata: { httpStatusCode: 200 },
      ContentType: 'text/html',
      ContentLength: 100,
      ETag: 'test-etag',
      Metadata: {
        timestamp: '12345',
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

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/test.html',
      ext: '.html',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.equal(result.status, 403);
    assert.equal(result.metadata.id, 'test-id');
  });

  it('test putSource handles bucket.put error without metadata', async () => {
    const context = {
      data: { data: 'Content' },
    };

    const mockHead = async () => ({
      $metadata: { httpStatusCode: 200 },
      ContentType: 'text/html',
      ContentLength: 100,
      ETag: 'test-etag',
      Metadata: {
        timestamp: '12345',
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

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/test.html',
      ext: '.html',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.equal(result.status, 500);
    assert.equal(result.metadata.id, 'test-id-500');
  });

  it('test putSource with JSON content type', async () => {
    const context = {
      data: { data: '{"key": "value"}' },
    };

    const mockHead = async () => null;

    const mockPut = async (path, body, contentType) => {
      assert.equal(path, 'org/site/api/data.json');
      assert.equal(body, '{"key": "value"}');
      assert.equal(contentType, 'application/json');
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'org',
      site: 'site',
      resourcePath: '/api/data.json',
      ext: '.json',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.equal(result.status, 200);
    assert.ok(result.metadata.id);
  });

  it('test putSource constructs path correctly', async () => {
    const context = {
      data: { data: 'test' },
    };

    const mockHead = async () => null;

    const mockPut = async (path) => {
      assert.equal(path, 'mycompany/myproject/docs/page.html');
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'mycompany',
      site: 'myproject',
      resourcePath: '/docs/page.html',
      ext: '.html',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.equal(result.status, 200);
  });

  it('test putSource timestamp is current', async () => {
    const context = {
      data: { data: 'content' },
    };

    const mockHead = async () => null;

    const beforeTimestamp = Date.now();

    const mockPut = async (_path, _body, _contentType, metadata) => {
      const timestamp = parseInt(metadata.timestamp, 10);
      assert.ok(timestamp >= beforeTimestamp);
      assert.ok(timestamp <= Date.now());
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/test.html',
      ext: '.html',
    };

    await putSource({ context, info, storage: mockS3Storage });
  });

  it('test putSource with HTML content type', async () => {
    const context = {
      data: { data: '<html><body>Hello</body></html>' },
    };

    const mockHead = async () => null;

    const mockPut = async (path, body, contentType) => {
      assert.equal(body, '<html><body>Hello</body></html>');
      assert.equal(contentType, 'text/html');
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/page.html',
      ext: '.html',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.equal(result.status, 200);
    assert.ok(result.metadata.id);
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
      Metadata: {
        timestamp: '12345',
        id: 'existing-id-123',
      },
    });

    const mockPut = async (path, body, contentType, metadata) => {
      assert.equal(body, 'Updated content');
      assert.equal(metadata.id, 'existing-id-123');
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/test.html',
      ext: '.html',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.equal(result.status, 200);
    assert.equal(result.metadata.id, 'existing-id-123');
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
      Metadata: {
        timestamp: '12345',
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

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/test.html',
      ext: '.html',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.equal(result.status, 409);
    assert.equal(result.metadata.id, 'wrong-id');
    assert.ok(result.body.includes('ID mismatch'));
  });

  it('test putSource with guid for new resource uses the provided guid', async () => {
    const context = {
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
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/new.html',
      ext: '.html',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    // When guid is provided for non-existent resource, it uses the provided guid
    assert.equal(result.status, 200);
    assert.equal(result.metadata.id, 'provided-id-456');
  });

  it('test putSource without data in context.data', async () => {
    const context = {
      data: {},
    };

    const mockHead = async () => null;

    const mockPut = async (path, body) => {
      assert.equal(body, undefined);
      return { $metadata: { httpStatusCode: 200 } };
    };

    const bucket = {
      head: mockHead,
      put: mockPut,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/test.html',
      ext: '.html',
    };

    const result = await putSource({ context, info, storage: mockS3Storage });
    assert.equal(result.status, 200);
    assert.ok(result.metadata.id);
  });
});
