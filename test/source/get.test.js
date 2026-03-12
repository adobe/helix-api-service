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
import { getSource, headSource } from '../../src/source/get.js';
import { createContext, createInfo, Nock } from '../utils.js';

describe('Source GET Tests', () => {
  let context;
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    context = createContext();
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('test getSource with full body', async () => {
    nock.source()
      .getObject('/test/rest/toast/jam.html')
      .reply(200, 'The body', {
        'content-type': 'text/plain',
        'content-length': '8',
        etag: '"some-etag-327"',
        'last-modified': 'Thu, 13 Nov 2025 13:44:08 GMT',
      });

    const info = createInfo('/test/sites/rest/source/toast/jam.html');
    const resp = await getSource(context, info);
    assert.equal(await resp.text(), 'The body');
    assert.equal(resp.status, 200);
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/plain',
      'content-length': '8',
      etag: '"some-etag-327"',
      'last-modified': 'Thu, 13 Nov 2025 13:44:08 GMT',
    });
  });

  it('test getSource not found returns 404', async () => {
    nock.source()
      .getObject('/test/site/not/there.html')
      .reply(404);

    const info = createInfo('/test/sites/site/source/not/there.html');
    const resp = await getSource(context, info);
    assert.equal(resp.status, 404);
    assert.equal(resp.headers.get('x-error'), null, '404 is not an error');
  });

  it('test headSource returns metadata', async () => {
    nock.source()
      .headObject('/myorg/mysite/document.html')
      .reply(200, null, {
        'content-type': 'text/html',
        etag: '"abc123"',
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
        'content-length': '111',
        'x-amz-meta-uncompressed-length': '587',
      });
    const info = createInfo('/myorg/sites/mysite/source/document.html');

    const resp = await headSource(context, info);
    assert.equal(resp.status, 200);
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/html',
      etag: '"abc123"',
      'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      'content-length': '587',
    });
    assert.equal(await resp.text(), '');
  });

  it('test headSource returns metadata with fallback content length', async () => {
    nock.source()
      .headObject('/org1/site2/somewhere/sheet.json')
      .reply(200, null, {
        'content-type': 'application/json',
        etag: '"sometag"',
        'last-modified': 'Tue, 09 Dec 2025 12:34:56 GMT',
        'content-length': '876',
      });
    const info = createInfo('/org1/sites/site2/source/somewhere/sheet.json');

    const resp = await headSource(context, info);
    assert.equal(resp.status, 200);
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'application/json',
      etag: '"sometag"',
      'last-modified': 'Tue, 09 Dec 2025 12:34:56 GMT',
      'content-length': '876',
    });
    assert.equal(await resp.text(), '');
  });

  it('test headSource returns 404 when not found', async () => {
    nock.source()
      .headObject('/test/site/missing.html')
      .reply(404);
    const info = createInfo('/test/sites/site/source/missing.html');

    const resp = await headSource(context, info);
    assert.equal(resp.status, 404);
  });

  it('test getSource handles error', async () => {
    nock.source()
      .getObject('/test/site/forbidden.html')
      .reply(403);
    const info = createInfo('/test/sites/site/source/forbidden.html');

    const resp = await getSource(context, info);
    assert.equal(resp.status, 403);
  });

  it('test headSource handles error', async () => {
    nock.source()
      .headObject('/test/site/error.html')
      .replyWithError('Oh no!');
    const info = createInfo('/test/sites/site/source/error.html');
    const resp = await headSource(context, info);
    assert.equal(resp.status, 500);
    assert.equal('Oh no!', resp.headers.get('x-error'));
  });

  it('test getSource with JSON content', async () => {
    nock.source()
      .getObject('/org/site/data.json')
      .reply(200, '{"name":"test","value":123}', {
        'content-type': 'application/json',
        'content-length': '27',
        etag: 'myetag',
        'last-modified': new Date(1111111111111).toUTCString(),
      });

    const info = createInfo('/org/sites/site/source/data.json');
    const resp = await getSource(context, info);

    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), '{"name":"test","value":123}');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'application/json',
      'content-length': '27',
      etag: 'myetag',
      'last-modified': 'Fri, 18 Mar 2005 01:58:31 GMT',
    });
  });

  it('test get version', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KKBMRNGEE0AWR7NZ2547HA51',
      });

    nock.source()
      .getObject('/myorg/mysite/.versions/01KKBMRNGEE0AWR7NZ2547HA51/01KK1E35DP7EQDG9G99QQAVQ1C')
      .reply(200, 'Hello, world!', {
        'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT',
      });

    context.config.org = 'myorg';
    context.config.site = 'mysite';

    const info = createInfo('/myorg/sites/mysite/source/a/b/c.html/.versions/01KK1E35DP7EQDG9G99QQAVQ1C');
    const resp = await getSource(context, info);
    assert.equal(resp.status, 200);
    assert.equal('Hello, world!', await resp.text());
  });

  const BUCKET_LIST_RESULT = `
    <ListBucketResult>
      <Name>my-bucket</Name>
      <Prefix>myorg/mysite/.versions/01KKEW3WV6TW3K967GKR89GJZR/</Prefix>
      <Marker></Marker>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>myorg/mysite/.versions/01KKEW3WV6TW3K967GKR89GJZR/01KKEW499YXV1RQFZNK271VB5W</Key>
        <LastModified>2021-01-01T00:00:00.000Z</LastModified>
        <Size>123</Size>
        <Path>01KKEW499YXV1RQFZNK271VB5W</Path>
      </Contents>
    </ListBucketResult>`;

  it('test list versions', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KKEW3WV6TW3K967GKR89GJZR',
      });
    nock.source()
      .headObject('/myorg/mysite/.versions/01KKEW3WV6TW3K967GKR89GJZR/01KKEW499YXV1RQFZNK271VB5W')
      .reply(200, null, {
        etag: 'blah',
        'x-amz-meta-doc-path-hint': '/a/b/c.html',
        'x-amz-meta-version-by': 'hello@example.com',
        'x-amz-meta-version-operation': 'myop',
      });

    nock.source()
      .get('/')
      .query({
        delimiter: '/',
        'list-type': '2',
        prefix: 'myorg/mysite/.versions/01KKEW3WV6TW3K967GKR89GJZR/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_RESULT));

    const info = createInfo('/myorg/sites/mysite/source/a/b/c.html/.versions');
    const resp = await getSource(context, info);
    assert.equal(resp.status, 200);

    const versions = await resp.json();
    const expectedVersion = [
      {
        version: '01KKEW499YXV1RQFZNK271VB5W',
        'version-date': '2021-01-01T00:00:00.000Z',
        'version-by': 'hello@example.com',
        'doc-path-hint': '/a/b/c.html',
        'version-operation': 'myop',
      },
    ];

    assert.deepStrictEqual(versions, expectedVersion);
  });
});
