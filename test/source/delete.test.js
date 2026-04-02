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
import xml2js from 'xml2js';
import { deleteSource } from '../../src/source/delete.js';
import { createInfo, Nock } from '../utils.js';
import { setupContext } from './testutils.js';

describe('Source Delete Tests', () => {
  let context;
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    context = setupContext();
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('test deleteSource moves to trash', async () => {
    nock.source()
      .headObject('/test/rest/toast/jam.html')
      .reply(200, null, {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });
    nock.source()
      .copyObject('/test/rest/.trash/jam.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/test/rest/toast/jam.html')
      .matchHeader('if-none-match', '*')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '314159',
        },
      }));
    nock.source()
      .deleteObject('/test/rest/toast/jam.html')
      .reply(204);

    const info = createInfo('/test/sites/rest/source/toast/jam.html');
    const resp = await deleteSource(context, info);
    assert.equal(resp.status, 204);
  });

  it('test deleteSource propagates S3 errors', async () => {
    nock.source()
      .headObject('/test/rest/toast/error.html')
      .reply(503);

    const info = createInfo('/test/sites/rest/source/toast/error.html');
    const resp = await deleteSource(context, info);
    assert.equal(resp.status, 503);
  });

  const BUCKET_LIST_RESULT = `
  <ListBucketResult>
    <Name>my-bucket</Name>
    <Prefix>org1/site2/a/b/</Prefix>
    <Marker></Marker>
    <MaxKeys>1000</MaxKeys>
    <IsTruncated>false</IsTruncated>
    <Contents>
      <Key>org1/site2/a/b/c/some.json</Key>
      <LastModified>2025-01-01T12:34:56.000Z</LastModified>
      <Size>32768</Size>
    </Contents>
    <Contents>
      <Key>org1/site2/a/b/c/my.pdf</Key>
      <LastModified>2025-01-01T12:34:56.000Z</LastModified>
      <Size>111</Size>
    </Contents>
    <Contents>
      <Key>org1/site2/a/b/page.html</Key>
      <LastModified>2021-12-31T01:01:01.001Z</LastModified>
      <Size>123</Size>
    </Contents>
  </ListBucketResult>`;

  const BUCKET_LIST_EMPTY_TRASH = `
    <ListBucketResult>
      <Name>my-bucket</Name>
      <Marker></Marker>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
    </ListBucketResult>`;

  it('test delete folder', async () => {
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        delimiter: '/',
        prefix: 'org1/site2/.trash/b/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_EMPTY_TRASH));
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'org1/site2/a/b/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_RESULT));

    nock.source()
      .headObject('/org1/site2/a/b/c/some.json')
      .reply(200, null, {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });
    nock.source()
      .headObject('/org1/site2/a/b/c/my.pdf')
      .reply(200, null, {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });
    nock.source()
      .headObject('/org1/site2/a/b/page.html')
      .reply(200, null, {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });
    nock.source()
      .copyObject('/org1/site2/.trash/b/c/some.json')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/some.json')
      .matchHeader('if-none-match', '*')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '314159',
        },
      }));
    nock.source()
      .copyObject('/org1/site2/.trash/b/c/my.pdf')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/my.pdf')
      .matchHeader('if-none-match', '*')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '314159',
        },
      }));
    nock.source()
      .copyObject('/org1/site2/.trash/b/page.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/page.html')
      .matchHeader('if-none-match', '*')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '314159',
        },
      }));

    nock.source()
      .deleteObject('/org1/site2/a/b/c/some.json')
      .reply(204);
    nock.source()
      .deleteObject('/org1/site2/a/b/c/my.pdf')
      .reply(204);
    nock.source()
      .deleteObject('/org1/site2/a/b/page.html')
      .reply(204);
    const info = createInfo('/org1/sites/site2/source/a/b/');
    const resp = await deleteSource(context, info);
    assert.equal(resp.status, 204);
  });

  const BUCKET_LIST_TRASH = `
    <ListBucketResult>
      <Name>my-bucket</Name>
      <Marker></Marker>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>org1/site2/.trash/b/hello.html</Key>
        <LastModified>2025-01-01T12:34:56.000Z</LastModified>
        <Size>3141592653</Size>
      </Contents>
    </ListBucketResult>`;

  it('test delete folder which is already in the trash', async () => {
    nock.source()
      .get('/')
      .query({
        delimiter: '/',
        'list-type': '2',
        prefix: 'org1/site2/.trash/b/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_TRASH));

    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'org1/site2/a/b/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_RESULT));

    nock.source()
      .headObject('/org1/site2/a/b/c/some.json')
      .reply(200, null, {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });
    nock.source()
      .headObject('/org1/site2/a/b/c/my.pdf')
      .reply(200, null, {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });
    nock.source()
      .headObject('/org1/site2/a/b/page.html')
      .reply(200, null, {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });

    // Note that the difference is here: the target folder (b) has a suffix of
    // 8 characters to make it unique.
    nock.source()
      .copyObject(/^\/org1\/site2\/.trash\/b-.{8}\/c\/some.json$/)
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/some.json')
      .matchHeader('if-none-match', '*')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '314159',
        },
      }));
    nock.source()
      .copyObject(/^\/org1\/site2\/.trash\/b-.{8}\/c\/my.pdf$/)
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/my.pdf')
      .matchHeader('if-none-match', '*')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '314159',
        },
      }));
    nock.source()
      .copyObject(/^\/org1\/site2\/.trash\/b-.{8}\/page.html$/)
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/page.html')
      .matchHeader('if-none-match', '*')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '314159',
        },
      }));

    nock.source()
      .deleteObject('/org1/site2/a/b/c/some.json')
      .reply(204);
    nock.source()
      .deleteObject('/org1/site2/a/b/c/my.pdf')
      .reply(204);
    nock.source()
      .deleteObject('/org1/site2/a/b/page.html')
      .reply(204);

    const info = createInfo('/org1/sites/site2/source/a/b/');
    const resp = await deleteSource(context, info);
    assert.equal(resp.status, 204);
  });

  it('test delete folder not found', async () => {
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        delimiter: '/',
        prefix: 'org1/site2/.trash/nope/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_EMPTY_TRASH));
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'org1/site2/nope/',
      })
      .reply(200, Buffer.from('<ListBucketResult><Name>abc</Name></ListBucketResult>'));
    const info = createInfo('/org1/sites/site2/source/nope/');
    const resp = await deleteSource(context, info);
    assert.equal(resp.status, 404);
  });

  it('test delete folder with file error', async () => {
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        delimiter: '/',
        prefix: 'org1/site2/.trash/b/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_EMPTY_TRASH));
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'org1/site2/a/b/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_RESULT));

    nock.source()
      .headObject('/org1/site2/a/b/c/some.json')
      .reply(200, null, {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });
    nock.source()
      .headObject('/org1/site2/a/b/c/my.pdf')
      .reply(200, null, {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });
    nock.source()
      .headObject('/org1/site2/a/b/page.html')
      .reply(200, null, {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });
    nock.source()
      .copyObject('/org1/site2/.trash/b/c/some.json')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/some.json')
      .matchHeader('if-none-match', '*')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '314159',
        },
      }));
    nock.source()
      .copyObject('/org1/site2/.trash/b/c/my.pdf')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/my.pdf')
      .matchHeader('if-none-match', '*')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '314159',
        },
      }));
    nock.source()
      .copyObject('/org1/site2/.trash/b/page.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/page.html')
      .matchHeader('if-none-match', '*')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '314159',
        },
      }));

    nock.source()
      .deleteObject('/org1/site2/a/b/c/some.json')
      .reply(500);
    nock.source()
      .deleteObject('/org1/site2/a/b/c/my.pdf')
      .reply(204);
    nock.source()
      .deleteObject('/org1/site2/a/b/page.html')
      .reply(500);
    const info = createInfo('/org1/sites/site2/source/a/b/');
    const resp = await deleteSource(context, info);
    assert.equal(resp.status, 500);
  });

  it('test delete folder error', async () => {
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        delimiter: '/',
        prefix: 'org1/site2/.trash/nope/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_EMPTY_TRASH));
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'org1/site2/nope/',
      })
      .reply(503);
    const info = createInfo('/org1/sites/site2/source/nope/');
    const resp = await deleteSource(context, info);
    assert.equal(resp.status, 503);
  });
});
