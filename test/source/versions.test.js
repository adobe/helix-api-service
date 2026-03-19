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
import { getOrListVersions, postVersion } from '../../src/source/versions.js';
import { MAX_SOURCE_BUCKET_RETRY } from '../../src/source/utils.js';
import { createInfo, Nock } from '../utils.js';
import { setupContext } from './testutils.js';

describe('Versions Tests', () => {
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

  it('test postVersion', async () => {
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

    const resp = await postVersion(context, 'myorg/mysite/a/b/c.html', 'testing', 'test comment');
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('location'), `/myorg/sites/mysite/source/a/b/c.html/.versions/${versionId}`);
  });

  it('test postVersion precondition failed, retry', async () => {
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

    const resp = await postVersion(context, 'myorg/mysite/a/b/c.html');
    assert.equal(resp.status, 201);
  });

  it('test postVersion precondition failed, too many retries', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .times(MAX_SOURCE_BUCKET_RETRY * 2)
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
        'last-modified': 'Tue, 04 Jun 2024 14:20:00 GMT',
      });

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .times(MAX_SOURCE_BUCKET_RETRY)
      .reply(412);

    const resp = await postVersion(context, 'myorg/mysite/a/b/c.html', 'abc', 'def');
    assert.equal(resp.status, 412);
  });

  it('test postVersion error', async () => {
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

    const resp = await postVersion(context, 'myorg/mysite/a/b/c.html');
    assert.equal(resp.status, 403);
  });

  it('test postVersion invalid base key', async () => {
    const resp = await postVersion(context, '/myorg/mysite/a/b/c.html');
    assert.equal(resp.status, 400);
  });

  const BUCKET_LIST_RESULT = `
    <ListBucketResult>
      <Name>my-bucket</Name>
      <Prefix>myorg/mysite/.versions/01KK1E35DP7EQDG9G99QQAVQ1Z/</Prefix>
      <Marker></Marker>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>myorg/mysite/.versions/01KK1E35DP7EQDG9G99QQAVQ1Z/01KK1E35DP7EQDG9G99QQAVQ1Z</Key>
        <LastModified>2025-01-01T00:00:00.000Z</LastModified>
        <Size>123</Size>
        <Path>01KK1E35DP7EQDG9G99QQAVQ1Z</Path>
      </Contents>
      <Contents>
        <Key>myorg/mysite/.versions/01KK1E35DP7EQDG9G99QQAVQ1Z/01KK1E35DP7EQDG9G99QQAVQ1A</Key>
        <LastModified>2021-02-02T00:00:00.000Z</LastModified>
        <Size>456</Size>
        <Path>01KK1E35DP7EQDG9G99QQAVQ1A</Path>
      </Contents>
    </ListBucketResult>`;

  it('test list versions', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
      });
    nock.source()
      .headObject('/myorg/mysite/.versions/01KK1E35DP7EQDG9G99QQAVQ1Z/01KK1E35DP7EQDG9G99QQAVQ1Z')
      .reply(200, null, {
        etag: 'blah',
        'x-amz-meta-doc-path-hint': '/a/b/c.html',
        'x-amz-meta-doc-last-modified': '2021-05-05T00:00:00.000Z',
        'x-amz-meta-doc-last-modified-by': 'harry@example.com',
        'x-amz-meta-version-by': 'billy@example.com',
        'x-amz-meta-version-operation': 'preview',
        'x-amz-meta-version-comment': 'test comment',
      });
    nock.source()
      .headObject('/myorg/mysite/.versions/01KK1E35DP7EQDG9G99QQAVQ1Z/01KK1E35DP7EQDG9G99QQAVQ1A')
      .reply(200, null, {
        etag: 'boo',
        'x-amz-meta-doc-path-hint': '/a/b/d.html',
        'x-amz-meta-version-by': 'jolo@example.com',
      });

    nock.source()
      .get('/')
      .query({
        delimiter: '/',
        'list-type': '2',
        prefix: 'myorg/mysite/.versions/01KK1E35DP7EQDG9G99QQAVQ1Z/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_RESULT));

    const info = createInfo('/myorg/sites/mysite/source/a/b/c.html/.versions');
    const resp = await getOrListVersions(context, info);
    assert.equal(resp.status, 200);

    const versions = await resp.json();
    const expectedVersion = [
      {
        version: '01KK1E35DP7EQDG9G99QQAVQ1A',
        'version-date': '2021-02-02T00:00:00.000Z',
        'version-by': 'jolo@example.com',
        'doc-path-hint': '/a/b/d.html',
      },
      {
        version: '01KK1E35DP7EQDG9G99QQAVQ1Z',
        'version-date': '2025-01-01T00:00:00.000Z',
        'version-by': 'billy@example.com',
        'doc-path-hint': '/a/b/c.html',
        'doc-last-modified': '2021-05-05T00:00:00.000Z',
        'doc-last-modified-by': 'harry@example.com',
        'version-comment': 'test comment',
        'version-operation': 'preview',
      },
    ];

    assert.deepStrictEqual(versions, expectedVersion);
  });

  const EMPTY_BUCKET_LIST_RESULT = `
    <ListBucketResult>
      <Name>my-bucket</Name>
      <Prefix>myorg/mysite/.versions/01KK1E35DP7EQDG9G99QQAVQ1C/</Prefix>
      <Marker></Marker>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
    </ListBucketResult>`;

  it('test list versions, no versions', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1C',
      });
    nock.source()
      .get('/')
      .query({
        delimiter: '/',
        'list-type': '2',
        prefix: 'myorg/mysite/.versions/01KK1E35DP7EQDG9G99QQAVQ1C/',
      })
      .reply(200, Buffer.from(EMPTY_BUCKET_LIST_RESULT));

    const info = createInfo('/myorg/sites/mysite/source/a/b/c.html/.versions');
    const resp = await getOrListVersions(context, info);
    assert.equal(resp.status, 200);

    const versions = await resp.json();
    assert.deepStrictEqual(versions, []);
  });
});
