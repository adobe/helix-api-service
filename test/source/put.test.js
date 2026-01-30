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

    const body = await resp.json();
    // filter json so that only the src and dst keys are present (so that we only compare those)
    const json = body.copied.map((item) => ({ src: item.src, dst: item.dst }));
    assert.deepStrictEqual(json, [
      { src: 'testorg/testsite/src.html', dst: 'testorg/testsite/dst.html' },
    ]);
    assert.equal(resp.status, 200);
    assert.equal('application/json', resp.headers.get('content-type'));
  });

  it('test putSource file copy fails', async () => {
    nock.source()
      .copyObject('/testorg/testsite/dst.html')
      .reply(403);
    const path = '/testorg/sites/testsite/source/dst.html';
    const ctx = setupContext(path);
    ctx.data.source = '/src.html';
    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));
    assert.equal(resp.status, 403);
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
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '"98989"',
        },
      }));
    nock.source()
      .copyObject('/org1/site2/dest/d1.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/d1.html')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '"654"',
        },
      }));
    nock.source()
      .copyObject('/org1/site2/dest/d/d2.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org1/site2/a/b/c/d/d2.html')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '"65"',
        },
      }));

    const path = '/org1/sites/site2/source/dest/';
    const ctx = setupContext(path);
    ctx.data.source = '/a/b/c/';
    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));

    const body = await resp.json();

    // filter json so that only the src and dst keys are present (so that we only compare those)
    const json = body.copied.map((item) => ({ src: item.src, dst: item.dst }));
    assert.deepStrictEqual(json, [
      { src: 'org1/site2/a/b/c/somejson.json', dst: 'org1/site2/dest/somejson.json' },
      { src: 'org1/site2/a/b/c/d1.html', dst: 'org1/site2/dest/d1.html' },
      { src: 'org1/site2/a/b/c/d/d2.html', dst: 'org1/site2/dest/d/d2.html' },
    ]);
    assert.equal(resp.status, 200);
    assert.equal('application/json', resp.headers.get('content-type'));
  });

  it('test putSource copy dest folder but source is a file', async () => {
    const path = '/org1/sites/site2/source/dest/';
    const ctx = setupContext(path);
    ctx.data.source = '/a/b/c/somejson.json';
    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));

    assert.equal(resp.status, 400);
    assert.equal(resp.headers.get('x-error'), 'Source and destination type mismatch');
  });

  it('test putSource copy dest file but source is a folder', async () => {
    const path = '/org1/sites/site2/source/dest.html';
    const ctx = setupContext(path);
    ctx.data.source = '/a/b/c/';
    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));

    assert.equal(resp.status, 400);
    assert.equal(resp.headers.get('x-error'), 'Source and destination type mismatch');
  });

  it('test putSource moves a file', async () => {
    nock.source()
      .copyObject('/org123/456site/lala/dst.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org123/456site/foo/bar/src.html')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: 'ahahahaha',
        },
      }));
    nock.source()
      .deleteObject('/org123/456site/foo/bar/src.html')
      .reply(204);

    const path = '/org123/sites/456site/source/lala/dst.html';
    const ctx = setupContext(path);
    ctx.data.source = '/foo/bar/src.html';
    ctx.data.move = 'true';

    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.deepStrictEqual(body.moved, [
      { src: 'org123/456site/foo/bar/src.html', dst: 'org123/456site/lala/dst.html' },
    ]);
    assert.equal('application/json', resp.headers.get('content-type'));
  });

  it('test putSource file move fails', async () => {
    nock.source()
      .copyObject('/org123/456site/lala/dst.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/org123/456site/foo/bar/src.html')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: 'ahahahaha',
        },
      }));
    nock.source()
      .deleteObject('/org123/456site/foo/bar/src.html')
      .reply(203);

    const path = '/org123/sites/456site/source/lala/dst.html';
    const ctx = setupContext(path);
    ctx.data.source = '/foo/bar/src.html';
    ctx.data.move = 'true';

    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));
    assert.equal(resp.status, 203);
    assert.equal(resp.headers.get('x-error'), 'Failed to remove source');
  });

  const BUCKET_LIST_RESULT2 = `
    <ListBucketResult>
      <Name>abucket</Name>
      <Prefix>o/s/x/</Prefix>
      <Marker></Marker>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>o/s/x/x.html</Key>
        <LastModified>2025-01-01T12:34:56.000Z</LastModified>
        <Size>32768</Size>
      </Contents>
      <Contents>
        <Key>o/s/x/sub/x.pdf</Key>
        <LastModified>2026-01-30T01:01:01.001Z</LastModified>
        <Size>123</Size>
      </Contents>
    </ListBucketResult>`;

  it('test putSource moves a folder', async () => {
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'o/s/x/',
      })
      .twice()
      .reply(200, Buffer.from(BUCKET_LIST_RESULT2));

    nock.source()
      .copyObject('/o/s/hello/dest/x.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/o/s/x/x.html')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '7',
        },
      }));
    nock.source()
      .copyObject('/o/s/hello/dest/sub/x.pdf')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/o/s/x/sub/x.pdf')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '7',
        },
      }));

    function deleteBodyCheck(body) {
      assert(body.includes('<Delete'));
      assert(body.includes('<Object><Key>o/s/x/x.html</Key></Object>'));
      assert(body.includes('<Object><Key>o/s/x/sub/x.pdf</Key></Object>'));
      return true;
    }

    nock.source()
      .post('/?delete=', deleteBodyCheck)
      .reply(204, new xml2js.Builder().buildObject({
        DeleteObjectsOutput: {
          Deleted: [
            { Key: 'o/s/x/x.html' },
            { Key: 'o/s/x/sub/x.pdf' },
          ],
        },
      }));

    const path = '/o/sites/s/source/hello/dest/';
    const ctx = setupContext(path);
    ctx.data.source = '/x/';
    ctx.data.move = 'true';

    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));
    assert.equal(resp.status, 200);
    const body = await resp.json();

    // remove all keys from body except src and dst, for comparison
    const cmp = body.moved.map((item) => ({ src: item.src, dst: item.dst }));
    assert.deepStrictEqual(cmp, [
      { src: 'o/s/x/x.html', dst: 'o/s/hello/dest/x.html' },
      { src: 'o/s/x/sub/x.pdf', dst: 'o/s/hello/dest/sub/x.pdf' },
    ]);
    assert.equal('application/json', resp.headers.get('content-type'));
  });

  it('test putSource incompletely moves a folder', async () => {
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'o/s/x/',
      })
      .twice()
      .reply(200, Buffer.from(BUCKET_LIST_RESULT2));

    nock.source()
      .copyObject('/o/s/hello/dest/x.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/o/s/x/x.html')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '7',
        },
      }));
    nock.source()
      .copyObject('/o/s/hello/dest/sub/x.pdf')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/o/s/x/sub/x.pdf')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '7',
        },
      }));

    nock.source()
      .post('/?delete=')
      .reply(204, new xml2js.Builder().buildObject({
        DeleteObjectsOutput: {
          Deleted: [
            { Key: 'o/s/x/x.html' },
            // only return one of the 2 files, which will cause a 500
          ],
        },
      }));

    const path = '/o/sites/s/source/hello/dest/';
    const ctx = setupContext(path);
    ctx.data.source = '/x/';
    ctx.data.move = 'true';

    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));
    assert.equal(resp.status, 500);
    assert.equal(resp.headers.get('x-error'), 'Move operation failed');
  });

  it('test putSource moves a folder to its own subfolder is not allowed', async () => {
    const path = '/o/sites/s/source/x/hello/dest/';
    const ctx = setupContext(path);
    ctx.data.source = '/x/';
    ctx.data.move = 'true';

    const resp = await putSource(ctx, createInfo(path, {}, 'PUT'));
    assert.equal(resp.status, 400);
    assert.equal(resp.headers.get('x-error'), 'Destination cannot be a subfolder of source');
  });
});
