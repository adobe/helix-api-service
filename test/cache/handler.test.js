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
/* eslint-env mocha */
import assert from 'assert';
import esmock from 'esmock';
import { Request, Response } from '@adobe/fetch';
import { DEFAULT_CONTEXT_MAIN, Nock, main } from '../utils.js';
import { getLiveUrl } from '../../src/support/utils.js';

describe('Cache Handler Tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('POST requires owner parameter', async () => {
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/cache',
      },
    }));
    assert.strictEqual(result.status, 400);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'invalid path parameters: "owner" is required',
    });
  });

  it('POST requires repo parameter', async () => {
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/cache/owner',
      },
    }));
    assert.strictEqual(result.status, 400);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'invalid path parameters: "repo" is required',
    });
  });

  it('POST requires ref parameter', async () => {
    nock.config(null);
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/cache/owner/repo',
      },
    }));
    assert.strictEqual(result.status, 400);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'invalid path parameters: "ref" is required',
    });
  });

  it('sends method not allowed for unsupported method', async () => {
    nock.config();
    const result = await main(new Request('https://admin.hlx.page/?url=https://ref--repo--owner.hlx.live/foo', {
      method: 'PUT',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/cache/owner/repo/ref',
      },
    }));
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'method not allowed');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('sends 404 for missing project', async () => {
    nock.config(null);
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
    }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/cache/owner/repo/ref',
      },
      attributes: {
        contentBusId: null,
      },
    }));
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'project not found: owner/repo',
    });
  });

  it('handles purge via path', async () => {
    nock.config(null);
    const purges = [];
    const { main: proxyMain } = await esmock('../../src/index.js', {
      '../../src//cache/handler.js': await esmock('../../src/cache/handler.js', {
        '../../src/cache/purge.js': {
          purge: async (ctx, info) => {
            purges.push(getLiveUrl(ctx, info));
            return new Response('', {
              status: 200,
            });
          },
        },
      }),
    });

    const result = await proxyMain(new Request('https://admin.hlx.page/', { method: 'POST' }), DEFAULT_CONTEXT_MAIN({
      pathInfo: {
        suffix: '/cache/owner/repo/ref/foo',
      },
    }));
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
    assert.deepStrictEqual(purges, [
      'https://ref--repo--owner.aem.live/foo',
    ]);
  });
});
