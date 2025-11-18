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
import { createContext, createInfo, Nock } from '../utils.js';

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

  function setupContext(suffix, {
    attributes = {}, data = {},
  } = {}) {
    return createContext(suffix, {
      attributes,
      data,
      env: {
        HELIX_STORAGE_DISABLE_R2: 'true',
      },
    });
  }

  it('test putSource with existing resource (has ID)', async () => {
    async function putFn(_uri, gzipBody) {
      const b = await gunzip(Buffer.from(gzipBody, 'hex'));
      assert.equal(b.toString(), '<html><body>Hello</body></html>');
    }

    nock.source()
      .headObject('/tst/best/toast/jam.html')
      .reply(200, null, {
        'content-type': 'text/html',
        'last-modified': new Date(999999999999).toUTCString(),
        'x-amz-meta-id': 'existing-id-123',
      });
    nock.source()
      .putObject('/tst/best/toast/jam.html')
      .matchHeader('content-type', 'text/html')
      .matchHeader('x-amz-meta-id', 'existing-id-123')
      .reply(201, putFn);

    const path = '/tst/sites/best/source/toast/jam.html';
    const context = setupContext(path, { data: { data: '<html><body>Hello</body></html>' } });

    const resp = await putSource(context, createInfo(path));
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('x-da-id'), 'existing-id-123');
  });

  it('test putSource with new resource (generates new ID)', async () => {
    let generatedId;
    async function putFn(_uri, body) {
      generatedId = this.req.headers['x-amz-meta-id'];
      assert.match(generatedId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.deepStrictEqual(body, { something: 'else' });
    }

    nock.source()
      .headObject('/myorg/mysite/data/test.json')
      .reply(404);
    nock.source()
      .putObject('/myorg/mysite/data/test.json')
      .matchHeader('content-type', 'application/json')
      .reply(201, putFn);

    const path = '/myorg/sites/mysite/source/data/test.json';
    const context = setupContext(path, { data: { data: '{"something":"else"}' } });

    const resp = await putSource(context, createInfo(path));
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('x-da-id'), generatedId);
  });

  it('test putSource with unknown file extension returns 400', async () => {
    const path = '/test/sites/eest/source/file.bin';
    const resp = await putSource(setupContext(path), createInfo(path));
    assert.equal(resp.status, 415);
  });

  it('test putSource handles bucket.put error with metadata statuscode', async () => {
    nock.source()
      .headObject('/test/test/test.html')
      .reply(200, null, {
        'content-type': 'text/html',
        'last-modified': new Date().toUTCString(),
      });
    nock.source()
      .putObject('/test/test/test.html')
      .reply(403);

    const path = '/test/sites/test/source/test.html';
    const resp = await putSource(setupContext(path), createInfo(path));
    assert.equal(resp.status, 403);
  });

  it('test putSource with matching guid succeeds', async () => {
    async function putFn(_uri, gzipBody) {
      const b = await gunzip(Buffer.from(gzipBody, 'hex'));
      assert.equal(b.toString(), '<html>Updated content</html>');
    }

    nock.source()
      .headObject('/test/test/test.html')
      .reply(200, null, {
        'content-type': 'text/html',
        'last-modified': new Date().toUTCString(),
        'x-amz-meta-id': 'existing-id-123',
      });
    nock.source()
      .putObject('/test/test/test.html')
      .reply(204, putFn);

    const path = '/test/sites/test/source/test.html';
    const context = setupContext(path, {
      data: {
        data: '<html>Updated content</html>',
        guid: 'existing-id-123',
      },
    });

    const resp = await putSource(context, createInfo(path));
    assert.equal(resp.status, 204);
    assert.equal(resp.headers.get('x-da-id'), 'existing-id-123');
  });

  it('test putSource with mismatched guid returns 409', async () => {
    nock.source()
      .headObject('/test/test/test.html')
      .reply(200, null, {
        'content-type': 'text/html',
        'last-modified': new Date().toUTCString(),
        'x-amz-meta-id': 'existing-id-123',
      });

    const path = '/test/sites/test/source/test.html';
    const context = setupContext(path, {
      data: {
        data: 'Updated content',
        guid: 'wrong-id',
      },
    });

    const resp = await putSource(context, createInfo(path));
    assert.equal(resp.status, 409);
    const text = await resp.text();
    assert.ok(text.includes('ID mismatch'));
  });

  it('test putSource with guid for new resource uses the provided guid', async () => {
    async function putFn(_uri, gzipBody) {
      const b = await gunzip(Buffer.from(gzipBody, 'hex'));
      assert.equal(b.toString(), '<html>New content</html>');
    }

    nock.source()
      .headObject('/test/test/new.html')
      .reply(404);
    nock.source()
      .putObject('/test/test/new.html')
      .matchHeader('x-amz-meta-id', 'provided-id-456')
      .matchHeader('x-amz-meta-users', '[{"email":"test@example.com","user_id":"user-123.e"}]')
      .reply(200, putFn);

    const path = '/test/sites/test/source/new.html';
    const context = setupContext(path, {
      data: {
        data: '<html>New content</html>',
        guid: 'provided-id-456',
      },
      attributes: {
        authInfo: {
          profile: {
            email: 'test@example.com',
            user_id: 'user-123.e',
          },
        },
      },
    });

    const resp = await putSource(context, createInfo(path));
    // When guid is provided for non-existent resource, it uses the provided guid
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('x-da-id'), 'provided-id-456');
  });
});
