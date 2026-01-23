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
      .reply(201);

    const path = '/testorg/sites/testsite/source/dst.html';
    const ctx = setupContext(path);
    ctx.data.source = '/testorg/sites/testsite/source/src.html';
    const resp = await putSource(ctx, createInfo(path, {}, 'PUT', '<main></main>'));
    assert.equal(resp.status, 201);
  });
});
