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
import { promisify } from 'util';
import xml2js from 'xml2js';
import zlib from 'zlib';
import { putSource } from '../../src/source/put.js';
import { createInfo, Nock } from '../utils.js';
import { setupContext } from './testutils.js';

const gunzip = promisify(zlib.gunzip);

describe('Source PUT Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('test putSource HTML with user', async () => {
    const html = `
      <body>
        <main>
          Hello
          <img src="https://main--best--tst.aem.live/my-image.jpg">
        </main>
      </body>`;

    async function putFn(_uri, gzipBody) {
      const b = await gunzip(Buffer.from(gzipBody, 'hex'));
      assert.equal(b.toString(), html);
    }

    nock.source()
      .putObject('/tst/best/toast/jam.html')
      .matchHeader('content-type', 'text/html')
      .matchHeader('x-amz-meta-last-modified-by', 'test@example.com')
      .reply(201, putFn);

    const path = '/tst/sites/best/source/toast/jam.html';
    const context = setupContext(path, {
      attributes: {
        authInfo: {
          profile: {
            email: 'test@example.com',
            user_id: 'user-123.e',
          },
        },
      },
    });

    const resp = await putSource(
      context,
      createInfo(path, {}, 'PUT', html),
    );
    assert.equal(resp.status, 201);
  });

  it('test putSource HTML with If-None-Match condition', async () => {
    const html = '<body><main>Hello</main></body>';

    nock.source()
      .headObject('/myorg/mysite/my-page.html')
      .reply(404);
    nock.source()
      .putObject('/myorg/mysite/my-page.html')
      .matchHeader('content-type', 'text/html')
      .reply(201);

    const path = '/myorg/sites/mysite/source/my-page.html';
    const info = createInfo(path, { 'If-None-Match': '*' }, 'PUT', html);
    const resp = await putSource(setupContext(path), info);
    assert.equal(resp.status, 201);
  });

  it('test putSource HTML with failing If-Match condition', async () => {
    const html = '<body><main>Hello</main></body>';

    nock.source()
      .headObject('/myorg/mysite/my-page.html')
      .reply(404);

    const path = '/myorg/sites/mysite/source/my-page.html';
    const info = createInfo(path, { 'If-Match': '*' }, 'PUT', html);
    const resp = await putSource(setupContext(path), info);
    assert.equal(resp.status, 412);
  });

  it('test putSource HTML with external images is rejected', async () => {
    const html = `
      <body><main>
        Hello
        <img src="https://main--somesite--someorg.aem.live/myimg.jpeg">
      </main></body>`;

    const path = '/myorg/sites/mysite/source/my-page.html';
    const resp = await putSource(
      setupContext(path),
      createInfo(path, {}, 'PUT', html),
    );
    assert.equal(resp.status, 400);
    assert.match(resp.headers.get('x-error'), /External images are not allowed, use POST to intern them/);
  });

  it('test putSource JSON', async () => {
    function putFn(_uri, body) {
      assert.deepStrictEqual(body, { something: 'else' });
    }

    nock.source()
      .putObject('/myorg/mysite/data/test.json')
      .matchHeader('content-type', 'application/json')
      .matchHeader('x-amz-meta-last-modified-by', 'anonymous')
      .reply(201, putFn);

    const path = '/myorg/sites/mysite/source/data/test.json';
    const context = setupContext(path);

    const resp = await putSource(
      context,
      createInfo(path, {}, 'PUT', '{"something":"else"}'),
    );
    assert.equal(resp.status, 201);
  });

  it('test putSource with unknown file extension returns 400', async () => {
    const path = '/test/sites/eest/source/file.bin';
    const resp = await putSource(setupContext(path), createInfo(path));
    assert.equal(resp.status, 415);
  });

  it('test putSource handles bucket.put error with metadata statuscode', async () => {
    nock.source()
      .putObject('/test/test/test.html')
      .reply(403);

    const path = '/test/sites/test/source/test.html';
    const resp = await putSource(setupContext(path), createInfo(path, {}, 'PUT', '<main></main>'));
    assert.equal(resp.status, 403);
  });

  it('test putSource copies a file', async () => {
    nock.source()
      .copyObject('/testorg/testsite/dst.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/testorg/testsite/src.html')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '123',
        },
      }));

    const path = '/testorg/sites/testsite/source/dst.html';
    const ctx = setupContext(path);
    ctx.data.source = '/src.html';
    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));
    assert.equal(resp.status, 200);
  });

  const BUCKET_LIST_RESULT = `
    <ListBucketResult>
      <Name>my-bucket</Name>
      <Prefix>org1/site2/a/b/c/</Prefix>
      <Marker></Marker>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>org1/site2/a/b/c/somejson.json</Key>
        <LastModified>2025-01-01T12:34:56.000Z</LastModified>
        <Size>32768</Size>
      </Contents>
      <Contents>
        <Key>org1/site2/a/b/c/d1.html</Key>
        <LastModified>2021-12-31T01:01:01.001Z</LastModified>
        <Size>123</Size>
      </Contents>
      <Contents>
        <Key>org1/site2/a/b/c/d/d2.html</Key>
        <LastModified>2001-01-01T01:01:01.001Z</LastModified>
        <Size>88888</Size>
      </Contents>
      <CommonPrefixes>
        <Prefix>org1/site2/a/b/c/q/</Prefix>
      </CommonPrefixes>
    </ListBucketResult>`;

  it('test putSource copies a folder', async () => {
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'org1/site2/a/b/c/',
      })
      .reply(200, Buffer.from(BUCKET_LIST_RESULT));
    nock.source()
      .copyObject('/org1/site2/dest/somejson.json')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/somejson.json')
      .reply(200);
    nock.source()
      .copyObject('/org1/site2/dest/d1.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/d1.html')
      .reply(200);
    nock.source()
      .copyObject('/org1/site2/dest/d/d2.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/d/d2.html')
      .reply(200);

    const path = '/org1/sites/site2/source/dest/';
    const ctx = setupContext(path);
    ctx.data.source = '/a/b/c/';
    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));
    assert.equal(resp.status, 200);
  });
});
