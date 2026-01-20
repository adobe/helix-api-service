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
import { getValidHtml, validateJson, validateMedia } from '../../src/source/utils.js';
import { StatusCodeError } from '../../src/support/StatusCodeError.js';
import { createInfo } from '../utils.js';
import { setupContext, stripSpaces } from './testutils.js';

describe('Source Utils Tests', () => {
  it('test validateHtml success', async () => {
    const html = '<!DOCTYPE html><html><body><main>Hello</main></body></html>';
    await getValidHtml(setupContext(), Buffer.from(html));
    // No exception should be thrown
  });

  it('test validateHtml ignores acceptable HTML errors', async () => {
    const html = '<html><body><main>Hello</main></body></html>';
    await getValidHtml(setupContext(), Buffer.from(html));
    // No exception should be thrown
  });

  it('test validateHtml failure', async () => {
    const html = '<html><body>Hello</body></html';

    await assert.rejects(
      getValidHtml(setupContext(), Buffer.from(html)),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Unexpected end of file in tag/);
        return true;
      },
    );
  });

  it('test handle html media upload', async () => {
    const htmlIn = `<body>
      <main>
        <picture>
          <source srcset="https://example.com/image.jpg">
          <source srcset="https://example.com/image1.jpg" media="(prefers-color-scheme: dark)">
          <source srcset="https://example.com/image.jpg" media="(min-width: 600px)">
          <img src="https://example.com/image.jpg" loading="lazy">
        </picture>
        <img src="https://foobar.com/image2.jpg">
        <img src="https://example.com/image.jpg">
      </main>
      </body>`;

    const context = setupContext();
    let counter = 0;
    const mockMH = {
      getBlob: async (url) => {
        counter += 1;
        const u = new URL(url);
        return { uri: `https://media.com/${counter}${u.pathname}` };
      },
    };

    const body = await getValidHtml(context, Buffer.from(htmlIn), ['https://foobar.com/'], mockMH);

    const htmlOut = `<body>
      <main>
        <picture>
          <source srcset="https://media.com/1/image.jpg">
          <source srcset="https://media.com/2/image1.jpg" media="(prefers-color-scheme: dark)">
          <source srcset="https://media.com/1/image.jpg" media="(min-width: 600px)">
          <img src="https://media.com/1/image.jpg" loading="lazy">
        </picture>
        <img src="https://foobar.com/image2.jpg">
        <img src="https://media.com/1/image.jpg">
      </main></body>`;

    assert.equal(stripSpaces(body), stripSpaces(htmlOut));
  });

  it('test error during media handler processing', async () => {
    const htmlIn = `
      <body><main>
        <img src="https://example.com/image.jpg">
      </main></body>`;

    const mockMH = {
      getBlob: () => { throw new Error(); },
    };

    await assert.rejects(
      getValidHtml(setupContext(), Buffer.from(htmlIn), [], mockMH),
      new StatusCodeError('Error getting blob for image: https://example.com/image.jpg', 400),
    );
  });

  it('test html validate only with external images fails', async () => {
    const htmlIn = `
      <body><main>
        <img src="https://example.com/image.jpg">
      </main></body>`;

    await assert.rejects(
      getValidHtml(setupContext(), Buffer.from(htmlIn), [], null),
      new StatusCodeError('External images are not allowed, use POST to intern them', 400),
    );
  });

  it('test a body element is synthesized if not present in the input HTML', async () => {
    const htmlIn = '<main><h1>Hello</h1></main>';

    const htmlOut = await getValidHtml(setupContext(), Buffer.from(htmlIn), [], {});
    assert.equal(stripSpaces(htmlOut), stripSpaces('<body><main><h1>Hello</h1></main></body>'));
  });

  it('test that a document with too many images is rejected', async () => {
    const tooManyImages = 201;

    // create a html document with too many images
    const images = Array.from({ length: tooManyImages }, (_, index) => `
      <img src="https://example.com/image${index}.jpg">
    `).join('');

    const htmlIn = `
      <body><main>
        ${images}
      </main></body>`;

    await assert.rejects(
      getValidHtml(setupContext(), Buffer.from(htmlIn), [], {}),
      new StatusCodeError('Too many images: 201', 400),
    );
  });

  it('test validateJson success', async () => {
    const json = '{"name":"test","value":123}';
    await validateJson(setupContext(), Buffer.from(json));
    // No exception should be thrown
  });

  it('test validateJson failure', async () => {
    const json = '{"name":"test","value":123';

    await assert.rejects(
      validateJson(setupContext(), Buffer.from(json)),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Invalid JSON:/);
        return true;
      },
    );
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

    await assert.rejects(
      validateMedia(setupContext(), info, 'video/mp4', Buffer.from(media)),
      new StatusCodeError(
        'Media not accepted \'/my.mp4\': Unable to parse MP4',
        400,
        'AEM_BACKEND_MP4_PARSING_FAILED',
      ),
    );
  });

  it('test validateMedia unknown media type', async () => {
    const media = 'somemedia';
    const info = createInfo(
      '/t/sites/s/source/my.file',
      {},
      'POST',
      media,
    );

    await assert.rejects(
      validateMedia(setupContext(), info, 'video/blah', Buffer.from(media)),
      new StatusCodeError('Unknown media type: video/blah', 400),
    );
  });
});
