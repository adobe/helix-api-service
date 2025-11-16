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
import { Response } from '@adobe/fetch';
import commonResponseHeaders from '../../src/wrappers/response-headers.js';

describe('Response Headers Tests', () => {
  const context = { log: { error: () => {} } };

  it('test response headers when origin is present', async () => {
    const headers = { origin: 'https://foo.org' };
    const req = new Request('https://example.com', { headers });
    const fn = async () => new Response('Hello, world!', { status: 200 });

    const resp = await commonResponseHeaders(fn)(req, context);
    assert.equal(resp.status, 200);
    assert.deepStrictEqual(resp.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': 'https://foo.org',
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'x-da-id, x-error, x-error-code',
    });
    assert.equal(resp.headers.get('cache-control'), 'no-store, private, must-revalidate');
  });

  it('test response headers when origin is not present', async () => {
    const req = new Request('https://example.com');

    const respHeaders = {
      'cache-control': 'max-age=10800',
    };
    const fn = async () => new Response('Hi there', { status: 201, headers: respHeaders });

    const resp = await commonResponseHeaders(fn)(req, context);
    assert.equal(resp.status, 201);
    assert.deepStrictEqual(resp.headers.plain(), {
      'cache-control': 'max-age=10800',
      'content-type': 'text/plain; charset=utf-8',
    });
  });
});
