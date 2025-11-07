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
import { readFile } from 'fs/promises';
import { resolve } from 'path';

import { Request } from '@adobe/fetch';

import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';

describe('Media Handler Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  const suffix = '/org/sites/site/media/';

  it('sends method not allowed for unsupported method', async () => {
    const result = await main(new Request('https://api.aem.live/'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: new AuthInfo().withRole('media_author').withAuthenticated(true),
      },
    });

    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'method not allowed');
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
    });
  });

  it('uploads media in body', async () => {
    const imageHash = '1dbf0793c2fcd45daca404c98ca98669364aca48d';
    nock.media()
      .putObject(`/${imageHash}`)
      .reply(201);

    const buffer = await readFile(resolve(__testdir, 'media/fixtures/sample.svg'));
    const result = await main(new Request('https://api.aem.live/', {
      method: 'POST', body: buffer, headers: { 'content-type': 'application/xml' },
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: new AuthInfo().withRole('media_author').withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      meta: {
        height: '54',
        width: '56',
        type: 'image/svg+xml',
      },
      uri: `https://main--site--org.aem.page/media_${imageHash}.svg#width=56&height=54`,
    });
  });

  it('uploads media as external source', async () => {
    const imageHash = '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc';
    nock.media()
      .putObject(`/${imageHash}`)
      .reply(201);

    nock('https://www.aem.live')
      .get('/sample.png')
      .replyWithFile(200, resolve(__testdir, 'media/fixtures/image.png'), {
        'content-type': 'image/png',
      });

    const result = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      body: new URLSearchParams({
        url: 'https://www.aem.live/sample.png',
      }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: new AuthInfo().withRole('media_author').withAuthenticated(true),
      },
    });

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      meta: {
        height: '74',
        width: '58',
        type: 'image/png',
      },
      uri: `https://main--site--org.aem.page/media_${imageHash}.png#width=58&height=74`,
    });
  });

  it('reports a 400 if no media is passed in request body', async () => {
    const result = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      headers: {
        'content-type': 'image/png',
      },
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: new AuthInfo().withRole('media_author').withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 400);
    assert.deepStrictEqual(await result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'missing media in request body',
    });
  });

  it('reports a 400 if no URL is passed in posted form', async () => {
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
      body: '',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: new AuthInfo().withRole('media_author').withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 400);
    assert.deepStrictEqual(await result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'missing URL',
    });
  });

  it('reports a 400 if no URL is passed in JSON body', async () => {
    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST',
      body: '{}',
      headers: {
        'content-type': 'application/json',
      },
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: new AuthInfo().withRole('media_author').withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 400);
    assert.deepStrictEqual(await result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'missing URL',
    });
  });

  it('reports a 409 if media validation fails', async () => {
    const buffer = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 56 54" style="enable-background:new 0 0 56 54;" xml:space="preserve">
   <circle cx="40" cy="40" r="24" style="stroke:#006600; fill:#00cc00">
    <script>alert('I can do evil things...');</script>
  </circle>
</svg>`);

    const result = await main(new Request('https://admin.hlx.page/', {
      method: 'POST', body: buffer, headers: { 'content-type': 'application/xml' },
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: new AuthInfo().withRole('media_author').withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 409);
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Script or event handler detected in SVG at: /svg/circle[0]',
    });
  });

  it('reports a 502 if media fetch returns a bad status', async () => {
    nock('https://www.aem.live')
      .get('/sample.png')
      .reply(404);

    const result = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      body: new URLSearchParams({
        url: 'https://www.aem.live/sample.png',
      }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: new AuthInfo().withRole('media_author').withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 502);
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Failed to fetch media at: https://www.aem.live/sample.png: 404',
    });
  });

  it('reports a 502 if media fetch throws', async () => {
    nock('https://www.aem.live')
      .get('/sample.png')
      .replyWithError('boohoo!');

    const result = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      body: new URLSearchParams({
        url: 'https://www.aem.live/sample.png',
      }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: new AuthInfo().withRole('media_author').withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 502);
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Failed to fetch media at: https://www.aem.live/sample.png: boohoo!',
    });
  });

  it('reports a 415 if media type is not supported', async () => {
    const buffer = Buffer.from('Hello world', 'utf-8');
    const result = await main(new Request('https://api.aem.live/', {
      method: 'POST',
      body: buffer,
      headers: {
        'content-type': 'text/plain',
      },
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: new AuthInfo().withRole('media_author').withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 415);
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'File type not supported: text/plain',
    });
  });
});
