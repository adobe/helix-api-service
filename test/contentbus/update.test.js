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
import assert from 'assert';
import { resolve } from 'path';
import {
  Nock, createContext, createInfo, SITE_CONFIG,
} from '../utils.js';
import update, { MAX_KEY_LENGTH } from '../../src/contentbus/update.js';

const CONTENT_BUS_ID = SITE_CONFIG.content.contentBusId;

describe('ContentBus Remove Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(suffix) {
    return {
      context: createContext(suffix, {
        attributes: {
          infoMarkerChecked: true,
        },
        env: { HELIX_STORAGE_DISABLE_R2: 'true' },
      }),
      info: createInfo(suffix),
    };
  }

  it('uses a key that is too long', async () => {
    const resourcePath = '0123456789'.repeat(104);
    const suffix = `/owner/sites/repo/preview/${resourcePath}`;

    const { context, info } = setupTest(suffix);

    const response = await update(context, info);
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.headers.get('x-error'), `resource path exceeds ${MAX_KEY_LENGTH - CONTENT_BUS_ID.length - 8} characters`);
  });

  it('redirects media', async () => {
    nock.google()
      .user()
      .files([{
        mimeType: 'image/png',
        name: 'image.png',
        id: '1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s',
        size: '6000',
      }])
      .file('1BTZv0jmGKbEJ3StwgG3VwCbPu4RFRH8s')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/image.png'), {
        'content-type': 'image/png',
      });
    nock.media()
      .putObject('/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc')
      .reply(201);
    nock.content()
      .putObject('/preview/image.png')
      .reply(201);

    const { context, info } = setupTest('/owner/sites/repo/preview/image.png');

    const response = await update(context, info);
    assert.strictEqual(response.status, 200);
  });

  it('preserve redirect', async () => {
    nock.google()
      .user()
      .documents([{
        mimeType: 'application/vnd.google-apps.document',
        name: 'index',
        id: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
      }]);

    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--gdocs2md%3Av7/invocations')
      .reply(200, JSON.stringify({
        statusCode: 200,
        headers: {
          'x-source-location': '1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
        },
        body: '# hello, world!',
      }));

    nock.content()
      .head('/preview/index.md')
      .reply(200, '', {
        'x-amz-meta-redirect-location': '/target',
      })
      .putObject('/preview/index.md')
      .reply(201);

    const { context, info } = setupTest('/owner/sites/repo/preview/');

    const response = await update(context, info);
    assert.strictEqual(response.status, 200);
  });
});
