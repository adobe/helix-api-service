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
import { getSource } from '../../src/source/get.js';

describe('Source GET Tests', () => {
  it('test getSource with full body', async () => {
    const context = { test: 707 };

    const mockGet = async (p, m) => {
      if (p !== 'test/rest/toast/jam.html') {
        return null;
      }
      m.ContentType = 'text/plain';
      m.timestamp = '12345';
      m.id = '999';
      return 'The body';
    };

    const bucket = {
      get: mockGet,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'rest',
      resourcePath: '/toast/jam.html',
    };
    const result = await getSource({ context, info });
    assert.equal(result.body, 'The body');
    assert.equal(result.contentType, 'text/plain');
    assert.equal(result.contentLength, 8);
    assert.equal(result.status, 200);
    assert.equal(result.lastModified, '12345');
    assert.equal(result.metadata.id, '999');
  });

  it('test getSource with headOnly=true returns metadata', async () => {
    const context = { test: 707 };

    const mockHead = async (path) => {
      assert.equal(path, 'myorg/mysite/document.html');
      return {
        $metadata: { httpStatusCode: 200 },
        ContentType: 'text/html',
        ContentLength: 1024,
        ETag: '"abc123"',
        Metadata: {
          timestamp: '67890',
          id: 'doc-id-456',
        },
      };
    };

    const bucket = {
      head: mockHead,
      get: async () => {
        assert.fail('GET should not be called when headOnly=true');
      },
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'myorg',
      site: 'mysite',
      resourcePath: '/document.html',
    };

    const result = await getSource({ context, info, headOnly: true });

    assert.equal(result.status, 200);
    assert.equal(result.contentType, 'text/html');
    assert.equal(result.contentLength, 1024);
    assert.equal(result.etag, '"abc123"');
    assert.equal(result.lastModified, '67890');
    assert.equal(result.metadata.id, 'doc-id-456');
    assert.equal(result.body, undefined);
  });

  it('test getSource with headOnly=true returns 404 when not found', async () => {
    const context = { test: 707 };

    const mockHead = async (path) => {
      assert.equal(path, 'test/site/missing.html');
      return null;
    };

    const bucket = {
      head: mockHead,
      get: async () => {
        assert.fail('GET should not be called when headOnly=true');
      },
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'site',
      resourcePath: '/missing.html',
    };

    const result = await getSource({ context, info, headOnly: true });

    assert.equal(result.status, 404);
    assert.equal(result.body, '');
    assert.equal(result.contentLength, 0);
  });

  it('test getSource handles error with httpStatusCode', async () => {
    const context = { test: 707 };

    const mockGet = async () => {
      const error = new Error('Access denied');
      error.$metadata = { httpStatusCode: 403 };
      throw error;
    };

    const bucket = {
      get: mockGet,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'site',
      resourcePath: '/forbidden.html',
    };

    const result = await getSource({ context, info });

    assert.equal(result.status, 403);
    assert.equal(result.body, '');
    assert.equal(result.contentLength, 0);
  });

  it('test getSource handles error without httpStatusCode', async () => {
    const context = { test: 707 };

    const mockGet = async () => {
      throw new Error('Unknown error');
    };

    const bucket = {
      get: mockGet,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'site',
      resourcePath: '/error.html',
    };

    const result = await getSource({ context, info });

    assert.equal(result.status, 404);
    assert.equal(result.body, '');
    assert.equal(result.contentLength, 0);
  });

  it('test getSource with headOnly handles error with httpStatusCode', async () => {
    const context = { test: 707 };

    const mockHead = async () => {
      const error = new Error('Server error');
      error.$metadata = { httpStatusCode: 500 };
      throw error;
    };

    const bucket = {
      head: mockHead,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'site',
      resourcePath: '/error.html',
    };

    const result = await getSource({ context, info, headOnly: true });

    assert.equal(result.status, 500);
    assert.equal(result.body, '');
    assert.equal(result.contentLength, 0);
  });

  it('test getSource with headOnly handles error without httpStatusCode', async () => {
    const context = { test: 707 };

    const mockHead = async () => {
      throw new Error('Generic error');
    };

    const bucket = {
      head: mockHead,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'site',
      resourcePath: '/error.html',
    };

    const result = await getSource({ context, info, headOnly: true });

    assert.equal(result.status, 404);
    assert.equal(result.body, '');
    assert.equal(result.contentLength, 0);
  });

  it('test getSource constructs path correctly', async () => {
    const context = {};

    let capturedPath;
    const mockGet = async (path, m) => {
      capturedPath = path;
      m.ContentType = 'application/json';
      m.timestamp = '11111';
      m.id = 'path-test-id';
      return '{"test":true}';
    };

    const bucket = {
      get: mockGet,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'mycompany',
      site: 'myproject',
      resourcePath: '/api/v1/data.json',
    };

    const result = await getSource({ context, info });

    assert.equal(capturedPath, 'mycompany/myproject/api/v1/data.json');
    assert.equal(result.status, 200);
    assert.equal(result.body, '{"test":true}');
  });

  it('test getSource with JSON content', async () => {
    const context = {};

    const mockGet = async (path, m) => {
      m.ContentType = 'application/json';
      m.timestamp = '22222';
      m.id = 'json-id';
      return '{"name":"test","value":123}';
    };

    const bucket = {
      get: mockGet,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'org',
      site: 'site',
      resourcePath: '/data.json',
    };

    const result = await getSource({ context, info });

    assert.equal(result.status, 200);
    assert.equal(result.contentType, 'application/json');
    assert.equal(result.body, '{"name":"test","value":123}');
    assert.equal(result.contentLength, 27);
  });

  it('test getSource with empty body', async () => {
    const context = {};

    const mockGet = async (path, m) => {
      m.ContentType = 'text/plain';
      m.timestamp = '33333';
      m.id = 'empty-id';
      return '';
    };

    const bucket = {
      get: mockGet,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'org',
      site: 'site',
      resourcePath: '/empty.txt',
    };

    const result = await getSource({ context, info });

    assert.equal(result.status, 200);
    assert.equal(result.body, '');
    assert.equal(result.contentLength, 0);
  });

  it('test getSource with different org/site/path combinations', async () => {
    const context = {};

    const testCases = [
      {
        info: { org: 'a', site: 'b', resourcePath: '/c' },
        expected: 'a/b/c',
      },
      {
        info: { org: 'org123', site: 'site456', resourcePath: '/path/to/file.txt' },
        expected: 'org123/site456/path/to/file.txt',
      },
      {
        info: { org: 'my-org', site: 'my-site', resourcePath: '/index.html' },
        expected: 'my-org/my-site/index.html',
      },
    ];

    const results = await Promise.all(testCases.map(async (testCase) => {
      let capturedPath;
      const mockGet = async (path, m) => {
        capturedPath = path;
        m.ContentType = 'text/html';
        m.timestamp = '55555';
        m.id = 'combo-id';
        return 'test';
      };

      const bucket = {
        get: mockGet,
      };

      const mockS3Storage = {
        sourceBus: () => bucket,
      };
      context.attributes = { storage: mockS3Storage };

      const result = await getSource({ context, info: testCase.info });

      return { capturedPath, expected: testCase.expected, result };
    }));

    results.forEach(({ capturedPath, expected, result }) => {
      assert.equal(capturedPath, expected);
      assert.equal(result.status, 200);
    });
  });

  it('test getSource with large body calculates correct length', async () => {
    const context = {};

    const largeBody = 'x'.repeat(10000);
    const mockGet = async (path, m) => {
      m.ContentType = 'text/plain';
      m.timestamp = '66666';
      m.id = 'large-id';
      return largeBody;
    };

    const bucket = {
      get: mockGet,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };
    context.attributes = { storage: mockS3Storage };

    const info = {
      org: 'test',
      site: 'test',
      resourcePath: '/large.txt',
    };

    const result = await getSource({ context, info });

    assert.equal(result.status, 200);
    assert.equal(result.body, largeBody);
    assert.equal(result.contentLength, 10000);
  });
});
