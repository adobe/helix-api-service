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
      m.ETag = '"some-etag-327"';
      m.LastModified = new Date(1763041448536);
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
    const resp = await getSource({ context, info });
    assert.equal(await resp.text(), 'The body');
    assert.equal(resp.status, 200);
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/plain',
      'content-length': '8',
      etag: '"some-etag-327"',
      'last-modified': 'Thu, 13 Nov 2025 13:44:08 GMT',
      'x-da-id': '999',
    });
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
        LastModified: new Date(1666666666666),
        Metadata: {
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

    const resp = await getSource({ context, info, headOnly: true });
    assert.equal(resp.status, 200);
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/html',
      'content-length': '1024',
      etag: '"abc123"',
      'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      'x-da-id': 'doc-id-456',
    });
    assert.equal(await resp.text(), '');
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

    const resp = await getSource({ context, info, headOnly: true });
    assert.equal(resp.status, 404);
  });

  it('test getSource handles error with httpStatusCode', async () => {
    const context = { log: { warn: () => {} } };

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

    const resp = await getSource({ context, info });
    assert.equal(resp.status, 403);
  });

  it('test getSource handles error without httpStatusCode', async () => {
    const context = { log: { error: () => {} } };

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

    const resp = await getSource({ context, info });
    assert.equal(resp.status, 500);
  });

  it('test getSource with headOnly handles error with httpStatusCode', async () => {
    const context = { log: { error: () => {} } };

    const mockHead = async () => {
      const error = new Error('Server error');
      error.$metadata = { httpStatusCode: 503 };
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

    const resp = await getSource({ context, info, headOnly: true });
    assert.equal(resp.status, 503);
  });

  it('test getSource with headOnly handles error without httpStatusCode', async () => {
    const context = { log: { error: () => {} } };

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

    const resp = await getSource({ context, info, headOnly: true });
    assert.equal(resp.status, 500);
  });

  it('test getSource with JSON content', async () => {
    const context = {};

    const mockGet = async (path, m) => {
      m.ContentType = 'application/json';
      m.ETag = 'myetag';
      m.LastModified = new Date(1111111111111);
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

    const resp = await getSource({ context, info });

    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), '{"name":"test","value":123}');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'application/json',
      'content-length': '27',
      etag: 'myetag',
      'last-modified': 'Fri, 18 Mar 2005 01:58:31 GMT',
      'x-da-id': 'json-id',
    });
  });
});
