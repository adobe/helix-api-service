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
import {
  postSource,
  validateHtml,
  validateJson,
  validateMedia,
} from '../../src/source/post.js';
import { createInfo, Nock } from '../utils.js';
import { setupContext } from './testutils.js';

const gunzip = promisify(zlib.gunzip);

describe('Source POST Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('test postSource HTML', async () => {
    async function postFn(_uri, gzipBody) {
      const b = await gunzip(Buffer.from(gzipBody, 'hex'));
      assert.equal(b.toString(), '<html><body>Hello</body></html>');
    }

    nock.source()
      .putObject('/test/rest/toast/jam.html')
      .matchHeader('content-type', 'text/html')
      .reply(201, postFn);

    const resp = await postSource(setupContext(), createInfo(
      '/test/sites/rest/source/toast/jam.html',
      {},
      'POST',
      '<html><body>Hello</body></html>',
    ));
    assert.equal(resp.status, 201);
  });

  it('test postSource JSON', async () => {
    const json = '{"name":"test","value":123}';

    function postFn(_uri, body) {
      assert.deepStrictEqual(body, JSON.parse(json));
    }

    nock.source()
      .putObject('/t/s/abc.json')
      .matchHeader('content-type', 'application/json')
      .reply(201, postFn);

    const resp = await postSource(setupContext(), createInfo(
      '/t/sites/s/source/abc.json',
      {},
      'POST',
      json,
    ));
    assert.equal(resp.status, 201);
  });

  it('test postSource PDF', async () => {
    async function postFn(_uri, gzipBody) {
      const b = await gunzip(Buffer.from(gzipBody, 'hex'));
      assert.equal(b.toString(), 'somepdf');
    }

    nock.source()
      .putObject('/org-x/site-y/my.pdf')
      .matchHeader('content-type', 'application/pdf')
      .reply(201, postFn);

    const resp = await postSource(setupContext(), createInfo(
      '/org-x/sites/site-y/source/my.pdf',
      {},
      'POST',
      'somepdf',
    ));
    assert.equal(resp.status, 201);
  });

  it('test postSource with unknown file extension returns 415', async () => {
    const path = '/org/sites/site/source/file.ugh';
    const resp = await postSource(setupContext(path), createInfo(path));
    assert.equal(resp.status, 415);
    assert.equal(resp.headers.get('x-error'), 'Unknown file type: .ugh');
  });

  it('test validateHtml success', async () => {
    const html = '<!DOCTYPE html><html><body>Hello</body></html>';
    const info = createInfo(
      '/test/sites/rest/source/toast/jam.html',
      {},
      'POST',
      html,
    );
    const body = await validateHtml(setupContext(), info);
    assert.equal(body.toString(), html);
  });

  it('test validateHtml ignores acceptable HTML errors', async () => {
    const html = '<html><body>Hello</body></html>';
    const info = createInfo(
      '/test/sites/rest/source/toast/jam.html',
      {},
      'POST',
      html,
    );
    const body = await validateHtml(setupContext(), info);
    assert.equal(body.toString(), html);
  });

  it('test validateHtml failure', async () => {
    const html = '<html><body>Hello</body></html';
    const info = createInfo(
      '/test/sites/rest/source/toast/jam.html',
      {},
      'POST',
      html,
    );

    try {
      await validateHtml(setupContext(), info);
    } catch (e) {
      assert.equal(e.statusCode, 400);
      assert.match(e.message, /Unexpected end of file in tag/);
    }
  });

  it('test validateJson success', async () => {
    const json = '{"name":"test","value":123}';
    const info = createInfo(
      '/test/sites/rest/source/toast/jam.json',
      {},
      'POST',
      json,
    );
    const body = await validateJson(setupContext(), info);
    assert.equal(body.toString(), json);
  });

  it('test validateJson failure', async () => {
    const json = '{"name":"test","value":123';
    const info = createInfo(
      '/test/sites/rest/source/toast/jam.json',
      {},
      'POST',
      json,
    );

    try {
      await validateJson(setupContext(), info);
    } catch (e) {
      assert.equal(e.statusCode, 400);
      assert.match(e.message, /Invalid JSON:/);
    }
  });

  it('test validateMedia success', async () => {
    const media = 'someimg';
    const info = createInfo(
      '/t/sites/s/source/my.jpg',
      {},
      'POST',
      media,
    );

    const body = await validateMedia(setupContext(), info, 'image/jpeg');
    assert.equal(body.toString(), media);
  });

  it('test validateMedia failure', async () => {
    const media = 'somemedia';
    const info = createInfo(
      '/t/sites/s/source/my.mp4',
      {},
      'POST',
      media,
    );

    try {
      await validateMedia(setupContext(), info, 'video/mp4');
    } catch (e) {
      assert.equal(e.statusCode, 400);
      assert.match(e.message, /Media not accepted/);
    }
  });

  it('test validateMedia unknown media type', async () => {
    const media = 'somemedia';
    const info = createInfo(
      '/t/sites/s/source/my.file',
      {},
      'POST',
      media,
    );

    try {
      await validateMedia(setupContext(), info, 'video/blah');
    } catch (e) {
      assert.equal(e.statusCode, 400);
      assert.match(e.message, /Unknown media type/);
    }
  });
});
