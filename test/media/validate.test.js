/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { MEDIA_TYPES } from '../../src/media/validate.js';
import { ValidationError } from '../../src/media/ValidationError.js';
import { createContext, Nock } from '../utils.js';

describe('validate media type', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('../../src/support/AdminContext.js').AdminContext} */
  let context;

  beforeEach(() => {
    nock = new Nock().env();
    context = createContext('/org/sites/site/media/');
  });

  afterEach(() => {
    nock.done();
  });

  describe('SVG', () => {
    const { validate } = MEDIA_TYPES.find(({ name }) => name === 'SVG');

    it('that has no <svg> root element', async () => {
      const contents = Buffer.from(`<xml xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="24" style="stroke:#006600; fill:#00cc00"/>
  </xml>`);
      await assert.rejects(
        async () => validate(context, '/foo.svg', contents),
        new ValidationError({
          message: 'Unable to preview \'/foo.svg\': Expected XML content with an SVG root item',
          code: 'AEM_BACKEND_SVG_ROOT_ITEM_MISSING',
        }),
      );
    });

    it('that has a script tag', async () => {
      const contents = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 56 54" style="enable-background:new 0 0 56 54;" xml:space="preserve">
    <circle cx="40" cy="40" r="24" style="stroke:#006600; fill:#00cc00">
      <script>alert('I can do evil things...');</script>
    </circle>
  </svg>`);

      await assert.rejects(
        async () => validate(context, '/foo.svg', contents),
        new ValidationError({
          message: 'Unable to preview \'/foo.svg\': Script or event handler detected in SVG at: /svg/circle[0]',
          code: 'AEM_BACKEND_SVG_SCRIPTING_DETECTED',
        }),
      );
    });

    it('that has an onload handler', async () => {
      const contents = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" onload="alert('XSS')">
    <rect width="100" height="100" fill="red"/>
  </svg>`);

      await assert.rejects(
        async () => validate(context, '/foo.svg', contents),
        new ValidationError({
          message: 'Unable to preview \'/foo.svg\': Script or event handler detected in SVG at: /svg',
          code: 'AEM_BACKEND_SVG_SCRIPTING_DETECTED',
        }),
      );
    });

    it('that has an unexpected character', async () => {
      const contents = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
    <svg version="1.1" id="Adobe_Express_Logo" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns:graph="&ns_graphs;"
        xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 240 234"
        style="enable-background:new 0 0 240 234;" xml:space="preserve">
    </svg>`);
      await assert.doesNotReject(async () => validate(context, '/foo.svg', contents));
    });

    it('successfully', async () => {
      const contents = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 56 54" style="enable-background:new 0 0 56 54;" xml:space="preserve">
    <circle cx="40" cy="40" r="24" style="stroke:#006600; fill:#00cc00"/>
  </svg>`);

      await assert.doesNotReject(async () => validate(context, '/foo.svg', contents));
    });
  });

  describe('MP4', () => {
    const { validate } = MEDIA_TYPES.find(({ name }) => name === 'MP4');

    it('that is not an MP4', async () => {
      const contents = Buffer.from('A cat jumps over the fence');
      await assert.rejects(
        async () => validate(context, '/foo.mp4', contents),
        new ValidationError({
          message: 'Unable to preview \'/foo.mp4\': Unable to parse MP4',
          code: 'AEM_BACKEND_MP4_PARSING_FAILED',
        }),
      );
    });
  });

  describe('ICO', () => {
    const { validate } = MEDIA_TYPES.find(({ name }) => name === 'ICO');

    it('successfully', async () => {
      const contents = Buffer.from('A cat jumps over the fence');
      const result = await validate(context, '/foo.ico', contents);
      assert.strictEqual(result, undefined);
    });

    it('that is too large', async () => {
      const contents = Buffer.from(String(new Array(18 * 1024).fill('A').join('')));
      await assert.rejects(
        async () => validate(context, '/foo.ico', contents),
        new ValidationError({
          message: 'Unable to preview \'/foo.ico\': ICO is larger than 16KB: 18.0KB',
          code: 'AEM_BACKEND_ICO_TOO_BIG',
        }),
      );
    });

    it('that is smaller than the custom limit', async () => {
      const { config } = context;
      config.limits = { preview: { maxICOSize: 2000000 } };

      const contents = Buffer.from(String(new Array(16 * 1024 + 512).fill('A').join('')));
      await assert.doesNotReject(async () => validate(context, '/foo.ico', contents));
    });
  });

  describe('PDF', () => {
    const { validate } = MEDIA_TYPES.find(({ name }) => name === 'PDF');

    it('that is too large', async () => {
      const contents = Buffer.from(String(new Array(26 * 1024 * 1024).fill('A').join('')));
      await assert.rejects(
        async () => validate(context, '/foo.pdf', contents),
        new ValidationError({
          message: 'Unable to preview \'/foo.pdf\': PDF is larger than 20MB: 26.0MB',
          code: 'AEM_BACKEND_PDF_TOO_BIG',
        }),
      );
    });

    it('that is smaller than the custom limit', async () => {
      const { config } = context;
      config.limits = { preview: { maxPDFSize: 30000000 } };

      const contents = Buffer.from(String(new Array(26 * 1024 * 1024).fill('A').join('')));
      await assert.doesNotReject(async () => validate(context, '/foo.pdf', contents));
    });
  });
});
