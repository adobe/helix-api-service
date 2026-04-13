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
import { getOrListVersions } from '../../src/source/versions.js';
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

  it('test getOrListVersionsCalled on wrong path', async () => {
    const info = createInfo('/myorg/sites/mysite/source/a/b/c.html');
    const resp = await getOrListVersions(context, info);
    assert.equal(resp.status, 400);
  });

  it('test getOrListVersionsCalled on with invalid ID', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1C',
      });

    const info = createInfo('/myorg/sites/mysite/source/a/b/c.html/.versions/not_a_ulid');
    const resp = await getOrListVersions(context, info);
    assert.equal(resp.status, 404);
    assert.equal(resp.headers.get('x-error'), 'Not a valid version');
  });
});
