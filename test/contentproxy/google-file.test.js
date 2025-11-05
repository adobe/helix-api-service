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
import { randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { Request } from '@adobe/fetch';
import { GoogleClient } from '@adobe/helix-google-support';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';

const TEST_BYTES = randomBytes(8192);

describe('Google File Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
    GoogleClient.setItemCacheOptions({ max: 1000 });

    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/', maxImageSize = undefined) {
    const suffix = `/org/sites/site/contentproxy${path}`;
    const config = maxImageSize
      ? {
        ...SITE_CONFIG,
        limits: { preview: { maxImageSize } },
      } : SITE_CONFIG;

    const request = new Request('https://localhost/');
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        config,
        googleApiOpts: { retry: false },
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    };
    return { request, context };
  }

  it('Rejects unsupported media type from Google Drive', async () => {
    const { request, context } = setupTest('/video.mov');
    const response = await main(request, context);

    assert.strictEqual(response.status, 415);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to preview \'/video.mov\': \'google\' backend does not support file type.',
      'x-error-code': 'AEM_BACKEND_UNSUPPORTED_MEDIA',
    });
  });

  it('Rejects file with excessive size', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'video/mp4',
        name: 'video.mp4',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
        size: '600000000',
      }]);

    const { request, context } = setupTest('/video.mp4');
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Files larger than 500mb are not supported: /video.mp4',
      'x-error-code': 'AEM_BACKEND_RESOURCE_TOO_BIG',
    });
  });

  it('Retrieves pdf from Google Drive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'application/pdf',
        name: 'foobar.pdf',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/empty.pdf'), {
        'content-type': 'application/pdf',
      });

    const { request, context } = setupTest('/foobar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-source-location'), 'gdrive:1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s');
    assert.strictEqual(response.headers.get('content-type'), 'application/pdf');
  });

  it('Rejects non-pdf from Google Drive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'application/pdf',
        name: 'foobar.pdf',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .reply(200, TEST_BYTES, {
        'content-type': 'application/pdf',
      });

    const { request, context } = setupTest('/foobar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(
      response.headers.get('x-error'),
      'Unable to preview \'/foobar.pdf\': content is not a \'PDF\' but: application/octet-stream',
    );
    assert.strictEqual(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  });

  it('Retrieves svg from Google Drive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'image/svg+xml',
        name: 'foobar.svg',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sample.svg'), {
        'content-type': 'image/svg+xml',
      });

    const { request, context } = setupTest('/foobar.svg');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-source-location'), 'gdrive:1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s');
    assert.strictEqual(response.headers.get('content-type'), 'image/svg+xml');
  });

  it('Rejects large svg from Google Drive', async () => {
    let svg = await readFile(resolve(__testdir, 'contentproxy/fixtures/sample.svg'), 'utf-8');
    svg += `<!-- ${'x'.repeat(40000)}  -->`;

    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'image/svg+xml',
        name: 'foobar.svg',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .reply(200, svg);

    const { request, context } = setupTest('/foobar.svg');
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to preview \'/foobar.svg\': SVG is larger than 40KB: 40.6KB');
  });

  it('Retrieves svg without xml prefix from Google Drive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'image/svg+xml',
        name: 'foobar.svg',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sample2.svg'), {
        'content-type': 'image/svg+xml',
      });

    const { request, context } = setupTest('/foobar.svg');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-source-location'), 'gdrive:1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s');
    assert.strictEqual(response.headers.get('content-type'), 'image/svg+xml');
  });

  it('Rejects incomplete svg with short prefix', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'image/svg+xml',
        name: 'foobar.svg',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .reply(200, '<sv', {
        'content-type': 'image/svg+xml',
      });

    const { request, context } = setupTest('/foobar.svg');
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(
      response.headers.get('x-error'),
      'Unable to preview \'/foobar.svg\': content is not a \'SVG\' but: application/octet-stream',
    );
    assert.strictEqual(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  });

  it('Rejects large image', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'image/png',
        name: 'large.png',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/image.png'), {
        'content-type': 'image/png',
      });

    const { request, context } = setupTest('/large.png', 100);
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(
      response.headers.get('x-error'),
      'Unable to preview \'/large.png\': Image is larger than 100B: 613B',
    );
    assert.strictEqual(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  });

  it('accepts image', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'image/png',
        name: 'large.png',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/image.png'), {
        'content-type': 'image/png',
      });

    const { request, context } = setupTest('/large.png');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'image/png');
  });

  it('Rejects non-svg from Google Drive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'image/svg+xml',
        name: 'foobar.svg',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .reply(200, TEST_BYTES, {
        'content-type': 'image/svg+xml',
      });

    const { request, context } = setupTest('/foobar.svg');
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(
      response.headers.get('x-error'),
      'Unable to preview \'/foobar.svg\': content is not a \'SVG\' but: application/octet-stream',
    );
    assert.strictEqual(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  });

  it('Retrieves mp4 from Google Drive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'video/mp4',
        name: 'foobar.mp4',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sample.mp4'), {
        'content-type': '',
      });

    const { request, context } = setupTest('/foobar.mp4');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-source-location'), 'gdrive:1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s');
    assert.strictEqual(response.headers.get('content-type'), 'video/mp4');
  });

  it('Rejects mp4 from Google Drive with high bitrate', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'video/mp4',
        name: 'foobar.mp4',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/high-bitrate.mp4'), {
        'content-type': '',
      });

    const { request, context } = setupTest('/foobar.mp4');
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to preview '/foobar.mp4': MP4 has a higher bitrate than 300 KB/s: 731 kilobytes",
      'x-error-code': 'AEM_BACKEND_MP4_BIT_RATE_TOO_HIGH',
    });
  });

  it('Rejects mp4 from Google Drive with excessive duration', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([{
        mimeType: 'video/mp4',
        name: 'foobar.mp4',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/long.mp4'), {
        'content-type': '',
      });

    const { request, context } = setupTest('/foobar.mp4');
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to preview '/foobar.mp4': MP4 is longer than 2 minutes: 2m 20s",
      'x-error-code': 'AEM_BACKEND_MP4_TOO_LONG',
    });
  });

  it('Serves 404 for missing file from Google Drive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([]);

    const { request, context } = setupTest('/foobar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });

  it('Serves 404 for missing svg from Google Drive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files([]);

    const { request, context } = setupTest('/foobar.svg');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });

  it('Propagates error from google drive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .files()
      .reply(500);

    const { request, context } = setupTest('/foobar.pdf');
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
  }).timeout(10000);
});
