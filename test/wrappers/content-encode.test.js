/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-disable no-console */

/* eslint-env mocha */
import assert from 'assert';
import { promisify } from 'util';
import zlib from 'zlib';
import { Request, Response } from '@adobe/fetch';
import { contentEncode as encode, getEncoding } from '../../src/wrappers/content-encode.js';

const gunzip = promisify(zlib.gunzip);
const unbrotli = promisify(zlib.brotliDecompress);

describe('Content Encode', () => {
  it('extracts the encodings correctly', () => {
    assert.deepStrictEqual(getEncoding(''), 'identity');
    assert.deepStrictEqual(getEncoding('gzip'), 'gzip');
    assert.deepStrictEqual(getEncoding('br, gzip'), 'br');
    assert.deepStrictEqual(getEncoding('*'), 'br');
    assert.deepStrictEqual(getEncoding('br;q=0.8, gzip;q=1.0'), 'gzip');
    assert.deepStrictEqual(getEncoding('compress;q=1.0 , br;q=0'), 'identity');
    assert.deepStrictEqual(getEncoding('compress;q=1.0 , br;q=0, *;q=0'), undefined);
  });

  it('gzip response if requested', async () => {
    const req = new Request('https://www.example.com', {
      headers: {
        'accept-encoding': 'gzip, compress',
      },
    });
    const resp = new Response('Hello, world.');
    const newResp = await encode(req, { log: console }, resp);
    assert.strictEqual(newResp.status, 200);
    assert.deepStrictEqual(newResp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'content-encoding': 'gzip',
      vary: 'Accept-Encoding',
    });
    const body = await newResp.buffer();
    const decoded = await gunzip(body);
    assert.strictEqual(decoded.toString('utf-8'), 'Hello, world.');
  });

  it('compress response with brotli if requested', async () => {
    const req = new Request('https://www.example.com', {
      headers: {
        'accept-encoding': 'gzip, br',
      },
    });
    const resp = new Response('Hello, world.');
    const newResp = await encode(req, { log: console }, resp);
    assert.strictEqual(newResp.status, 200);
    assert.deepStrictEqual(newResp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'content-encoding': 'br',
      vary: 'Accept-Encoding',
    });
    const body = await newResp.buffer();
    const decoded = await unbrotli(body);
    assert.strictEqual(decoded.toString('utf-8'), 'Hello, world.');
  });

  it('gzip 404 response if requested', async () => {
    const req = new Request('https://www.example.com', {
      headers: {
        'accept-encoding': 'gzip, compress',
      },
    });
    const resp = new Response('Hello, world.', {
      status: 404,
    });
    const newResp = await encode(req, { log: console }, resp);
    assert.strictEqual(newResp.status, 404);
    assert.deepStrictEqual(newResp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'content-encoding': 'gzip',
      vary: 'Accept-Encoding',
    });
    const body = await newResp.buffer();
    const decoded = await gunzip(body);
    assert.strictEqual(decoded.toString('utf-8'), 'Hello, world.');
  });

  it('preserves existing vary headers', async () => {
    const req = new Request('https://www.example.com', {
      headers: {
        'accept-encoding': 'gzip, compress',
      },
    });
    const resp = new Response('Hello, world.', {
      headers: {
        vary: 'x-test-header',
      },
    });
    const newResp = await encode(req, { log: console }, resp);
    assert.strictEqual(newResp.status, 200);
    assert.deepStrictEqual(newResp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'content-encoding': 'gzip',
      vary: 'x-test-header, Accept-Encoding',
    });
    const body = await newResp.buffer();
    const decoded = await gunzip(body);
    assert.strictEqual(decoded.toString('utf-8'), 'Hello, world.');
  });

  it('do not encode non 200 or 404', async () => {
    const req = new Request('https://www.example.com', {
      headers: {
        'accept-encoding': 'gzip, compress',
      },
    });
    const resp = new Response('Hello, world.', {
      status: 500,
    });
    const newResp = await encode(req, { log: console }, resp);
    assert.strictEqual(newResp.status, 500);
    assert.deepStrictEqual(newResp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
    });
    const body = await newResp.buffer();
    assert.strictEqual(body.toString('utf-8'), 'Hello, world.');
  });

  it('do not encode if no accept header', async () => {
    const req = new Request('https://www.example.com');
    const resp = new Response('Hello, world.');
    const newResp = await encode(req, { log: console }, resp);
    assert.strictEqual(newResp.status, 200);
    assert.deepStrictEqual(newResp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      vary: 'Accept-Encoding',
    });
    const body = await newResp.buffer();
    assert.strictEqual(body.toString('utf-8'), 'Hello, world.');
  });

  it('do not encode if not accepted', async () => {
    const req = new Request('https://www.example.com', {
      headers: {
        'accept-encoding': 'compress',
      },
    });
    const resp = new Response('Hello, world.');
    const newResp = await encode(req, { log: console }, resp);
    assert.strictEqual(newResp.status, 200);
    assert.deepStrictEqual(newResp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      vary: 'Accept-Encoding',
    });
    const body = await newResp.buffer();
    assert.strictEqual(body.toString('utf-8'), 'Hello, world.');
  });

  it('do not encode if already encoded', async () => {
    const req = new Request('https://www.example.com', {
      headers: {
        'accept-encoding': 'gzip',
      },
    });
    const resp = new Response('Hello, world.', {
      headers: {
        'content-encoding': 'gzip',
      },
    });
    const newResp = await encode(req, { log: console }, resp);
    assert.strictEqual(newResp.status, 200);
    assert.deepStrictEqual(newResp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'content-encoding': 'gzip',
      vary: 'Accept-Encoding',
    });
    const body = await newResp.buffer();
    assert.strictEqual(body.toString('utf-8'), 'Hello, world.');
  });
});
