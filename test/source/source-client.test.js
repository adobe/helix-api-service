/*
 * Copyright 2026 Adobe. All rights reserved.
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
import xml2js from 'xml2js';
import { createVersion } from '../../src/source/source-client.js';
import { MAX_SOURCE_BUCKET_RETRY } from '../../src/source/utils.js';
import { Nock } from '../utils.js';
import { setupContext } from './testutils.js';

describe('Source Client Tests', () => {
  let context;
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    context = setupContext();
    context.config.org = 'myorg';
    context.config.site = 'mysite';

    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('test createVersion', async () => {
    let versionId;

    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .twice()
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
        'last-modified': 'Fri, 18 Mar 2005 01:58:31 GMT',
      });

    async function copyFn(u) {
      const path = u.split('?')[0];
      const prefix = '/myorg/mysite/.versions/01KK1E35DP7EQDG9G99QQAVQ1Z/';
      assert(path.startsWith(prefix));
      versionId = path.slice(prefix.length);

      return new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '123',
        },
      });
    }

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .matchHeader('x-amz-copy-source', 'helix-source-bus/myorg/mysite/a/b/c.html')
      .matchHeader('x-amz-metadata-directive', 'REPLACE')
      .matchHeader('x-amz-meta-doc-id', '01KK1E35DP7EQDG9G99QQAVQ1Z')
      .matchHeader('x-amz-meta-doc-path-hint', '/a/b/c.html')
      .matchHeader('x-amz-meta-doc-last-modified', '2005-03-18T01:58:31.000Z')
      .matchHeader('x-amz-meta-version-by', 'anonymous')
      .matchHeader('x-amz-meta-version-operation', 'testing')
      .matchHeader('x-amz-meta-version-comment', 'test comment')
      .reply(200, copyFn);

    const resp = await createVersion(context, 'myorg/mysite/a/b/c.html', 'testing', 'test comment');
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('location'), `/myorg/sites/mysite/source/a/b/c.html/.versions/${versionId}`);
  });

  it('test createVersion precondition failed, retry', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .times(4)
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
        'last-modified': 'Tue, 04 Jun 2024 14:20:00 GMT',
      });

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .reply(412)
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '123',
        },
      }));

    const resp = await createVersion(context, 'myorg/mysite/a/b/c.html');
    assert.equal(resp.status, 201);
  });

  it('test createVersion precondition failed, too many retries', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .times((MAX_SOURCE_BUCKET_RETRY + 1) * 2)
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
        'last-modified': 'Tue, 04 Jun 2024 14:20:00 GMT',
      });

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .times(MAX_SOURCE_BUCKET_RETRY + 1)
      .reply(412);

    const resp = await createVersion(context, 'myorg/mysite/a/b/c.html', 'abc', 'def');
    assert.equal(resp.status, 412);
  });

  it('test createVersion precondition failed, configured max retries', async () => {
    context.attributes.maxSourceBucketRetry = 2;

    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .times(6)
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
        'last-modified': 'Tue, 04 Jun 2024 14:20:00 GMT',
      });

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .times(3)
      .reply(412);

    const resp = await createVersion(context, 'myorg/mysite/a/b/c.html', 'abc', 'def');
    assert.equal(resp.status, 412);
  });

  it('test createVersion error', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .twice()
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
        'last-modified': 'Tue, 04 Jun 2024 14:20:00 GMT',
      });

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .reply(403);

    const resp = await createVersion(context, 'myorg/mysite/a/b/c.html');
    assert.equal(resp.status, 403);
  });

  it('test createVersion invalid base key', async () => {
    const resp = await createVersion(context, '/myorg/mysite/a/b/c.html');
    assert.equal(resp.status, 400);
  });

  it('test createVersion with etag', async () => {
    nock.source()
      .headObject('/myorg/mysite/hello.html')
      .twice()
      .reply(200, null, {
        etag: 'mwhaha',
        'x-amz-meta-doc-id': '01KMD45QKPY7S9Y7BDKP0E019Q',
        'last-modified': 'Fri, 18 Mar 2005 01:58:31 GMT',
      });

    const etag = 'foobar';
    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KMD45QKPY7S9Y7BDKP0E019Q\/.+/)
      .matchHeader('x-amz-copy-source', 'helix-source-bus/myorg/mysite/hello.html')
      .matchHeader('x-amz-copy-source-if-match', etag)
      .matchHeader('x-amz-meta-doc-id', '01KMD45QKPY7S9Y7BDKP0E019Q')
      .matchHeader('x-amz-meta-doc-path-hint', '/hello.html')
      .matchHeader('x-amz-meta-doc-last-modified', '2005-03-18T01:58:31.000Z')
      .matchHeader('x-amz-meta-version-operation', 'test-op')
      .matchHeader('x-amz-meta-version-comment', 'test 123')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '987789',
        },
      }));

    const resp = await createVersion(context, 'myorg/mysite/hello.html', 'test-op', 'test 123', etag);
    assert.equal(resp.status, 201);
  });

  it('test createVersion on non-existing document gives 404', async () => {
    nock.source()
      .headObject('/myorg/mysite/hello.html')
      .reply(404);

    const resp = await createVersion(context, 'myorg/mysite/hello.html');
    assert.equal(resp.status, 404);
  });

  it('test createVersion with etag, does not retry on failure', async () => {
    nock.source()
      .headObject('/myorg/mysite/hello.html')
      .twice()
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
        'last-modified': 'Tue, 04 Jun 2024 14:20:00 GMT',
      });

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .reply(412);

    const resp = await createVersion(context, 'myorg/mysite/hello.html', 'abc', 'def', 'someetag');
    assert.equal(resp.status, 412);
  });
});
