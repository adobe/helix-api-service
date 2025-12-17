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
import { validateHtml, validateJson, validateMedia } from '../../src/source/utils.js';
import { createInfo } from '../utils.js';
import { setupContext } from './testutils.js';

describe('Source Utils Tests', () => {
  it('test validateHtml success', async () => {
    const html = '<!DOCTYPE html><html><body>Hello</body></html>';
    await validateHtml(setupContext(), Buffer.from(html));
    // No exception should be thrown
  });

  it('test validateHtml ignores acceptable HTML errors', async () => {
    const html = '<html><body>Hello</body></html>';
    await validateHtml(setupContext(), Buffer.from(html));
    // No exception should be thrown
  });

  it('test validateHtml failure', async () => {
    const html = '<html><body>Hello</body></html';

    try {
      await validateHtml(setupContext(), Buffer.from(html));
    } catch (e) {
      assert.equal(e.statusCode, 400);
      assert.match(e.message, /Unexpected end of file in tag/);
    }
  });

  it('test validateJson success', async () => {
    const json = '{"name":"test","value":123}';
    await validateJson(setupContext(), Buffer.from(json));
    // No exception should be thrown
  });

  it('test validateJson failure', async () => {
    const json = '{"name":"test","value":123';

    try {
      await validateJson(setupContext(), Buffer.from(json));
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

    await validateMedia(setupContext(), info, 'image/jpeg', Buffer.from(media));
    // No exception should be thrown
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
      await validateMedia(setupContext(), info, 'video/mp4', Buffer.from(media));
    } catch (e) {
      assert.equal(e.statusCode, 400);
      assert.equal(e.errorCode, 'AEM_BACKEND_MP4_PARSING_FAILED');
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
      await validateMedia(setupContext(), info, 'video/blah', Buffer.from(media));
    } catch (e) {
      assert.equal(e.statusCode, 400);
      assert.match(e.message, /Unknown media type/);
    }
  });
});
