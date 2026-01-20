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
import { postSource } from '../../src/source/post.js';
import { createInfo, Nock } from '../utils.js';
import { setupContext, stripSpaces } from './testutils.js';

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
      assert.equal(b.toString(), '<body><main>Hello</main></body>');
    }

    nock.source()
      .putObject('/test/rest/toast/jam.html')
      .matchHeader('content-type', 'text/html')
      .reply(201, postFn);

    const resp = await postSource(setupContext(), createInfo(
      '/test/sites/rest/source/toast/jam.html',
      {},
      'POST',
      '<html><body><main>Hello</main></body></html>',
    ));
    assert.equal(resp.status, 201);
  });

  it('test postSource index HTML', async () => {
    async function postFn(_uri, gzipBody) {
      const b = await gunzip(Buffer.from(gzipBody, 'hex'));
      assert.equal(b.toString(), '<body><main>Hello</main></body>');
    }

    nock.source()
      .putObject('/test/rest/toast/index.html')
      .matchHeader('content-type', 'text/html')
      .reply(201, postFn);

    const resp = await postSource(setupContext(), createInfo(
      '/test/sites/rest/source/toast/index.html',
      {},
      'POST',
      '<html><body><main>Hello</main></body></html>',
    ));
    assert.equal(resp.status, 201);
  });

  it('test postSource HTML with images', async () => {
    const imageHash = '1df1eef4cd16906957aa9d03ef3e2623e2bebecc2';

    /* The image form example.com should be interned, but the other ones should be
       left alone as they are in the list of kept image URLs. */
    const htmlIn = `
      <body><main>
        <img src="https://example.com/image.jpg">
        <img src="https://main--rest--test.aem.page/img1.jpg">
        <img src="https://main--rest--test.aem.live/img2.jpg">
        <img src="https://my.adobe.com/adobe/dynamicmedia/deliver/img3.jpg">
      </main></body>`;

    const htmlOut = `
      <body><main>
        <img src="https://main--rest--test.aem.page/media_${imageHash}.jpg">
        <img src="https://main--rest--test.aem.page/img1.jpg">
        <img src="https://main--rest--test.aem.live/img2.jpg">
        <img src="https://my.adobe.com/adobe/dynamicmedia/deliver/img3.jpg">
      </main></body>`;

    function imgPutFn(url, body) {
      assert.equal(body, 'someimg');
    }

    async function htmlPutFn(url, gzipBody) {
      const b = await gunzip(Buffer.from(gzipBody, 'hex'));
      assert.equal(
        stripSpaces(b.toString()),
        stripSpaces(htmlOut),
        'Should have interned the images to media bus',
      );
    }

    nock('https://example.com')
      .get('/image.jpg')
      .reply(200, 'someimg');

    nock.media()
      .headObject(`/${imageHash}`)
      .reply(404); // report it not found
    nock.media()
      .putObject(`/${imageHash}`)
      .reply(201, imgPutFn);
    nock.source()
      .putObject('/test/rest/toast/jam.html')
      .reply(201, htmlPutFn);

    const resp = await postSource(setupContext(), createInfo(
      '/test/sites/rest/source/toast/jam.html',
      {},
      'POST',
      htmlIn,
    ));
    assert.equal(resp.status, 201);
  });

  it('test postSource invalid HTML', async () => {
    const resp = await postSource(setupContext(), createInfo(
      '/test/sites/rest/source/toast/jam.html',
      {},
      'POST',
      '<body>Hello</bod',
    ));
    assert.equal(resp.status, 400);
    assert.deepStrictEqual(Object.fromEntries(resp.headers), {
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unexpected end of file in tag - Unexpected end of file. Expected `>` to close the tag',
    });
  });

  it('test postSource invalid HTML structure', async () => {
    const resp = await postSource(setupContext(), createInfo(
      '/test/sites/rest/source/toast/jam.html',
      {},
      'POST',
      '<body>Hello</bod>',
    ));
    assert.equal(resp.status, 400);
    assert.deepStrictEqual(Object.fromEntries(resp.headers), {
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'HTML does no contain a <main> element',
    });
  });

  it('test postSource HTML with If-None-Match condition', async () => {
    const html = '<body><main>Hello</main></body>';

    nock.source()
      .headObject('/myorg/mysite/my-page.html')
      .reply(200, null, {
        etag: '"yeehaa"',
        'last-modified': 'Tue, 29 Oct 2024 02:57:46 GMT',
      });
    nock.source()
      .putObject('/myorg/mysite/my-page.html')
      .matchHeader('content-type', 'text/html')
      .reply(201);

    const path = '/myorg/sites/mysite/source/my-page.html';
    const info = createInfo(path, { 'If-Match': '"yeehaa"' }, 'PUT', html);
    const resp = await postSource(setupContext(path), info);
    assert.equal(resp.status, 201);
  });

  it('test postSource HTML with failing If-None-Match condition', async () => {
    const html = '<body><main>Hello</main></body>';

    nock.source()
      .headObject('/myorg/mysite/my-page.html')
      .reply(200, null, {
        etag: '"yeehaa"',
        'last-modified': 'Tue, 29 Oct 2024 02:57:46 GMT',
      });

    const path = '/myorg/sites/mysite/source/my-page.html';
    const info = createInfo(path, { 'If-None-Match': '*' }, 'PUT', html);
    const resp = await postSource(setupContext(path), info);
    assert.equal(resp.status, 412);
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

  it('test postSource invalid JSON', async () => {
    const resp = await postSource(setupContext(), createInfo(
      '/t/sites/s/source/abc.json',
      {},
      'POST',
      '{"name":"test","value":123',
    ));
    assert.equal(resp.status, 400);
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

  it('test postSource invalid MP4', async () => {
    const resp = await postSource(setupContext(), createInfo(
      '/org-x/sites/site-y/source/my.mp4',
      {},
      'POST',
      'something',
    ));
    assert.equal(resp.status, 400);
    assert.equal(resp.headers.get('x-error-code'), 'AEM_BACKEND_MP4_PARSING_FAILED');
    assert.match(resp.headers.get('x-error'), /Unable to parse MP4/);
  });

  it('test postSource with unknown file extension returns 415', async () => {
    const path = '/org/sites/site/source/file.ugh';
    const resp = await postSource(setupContext(path), createInfo(path));
    assert.equal(resp.status, 415);
    assert.equal(resp.headers.get('x-error'), 'Unknown file type: .ugh');
  });
});
