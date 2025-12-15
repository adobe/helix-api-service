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

  it('test postSource invalid HTML', async () => {
    const resp = await postSource(setupContext(), createInfo(
      '/test/sites/rest/source/toast/jam.html',
      {},
      'POST',
      '<html><body>Hello</bod',
    ));
    assert.equal(resp.status, 400);
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
