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
import sinon from 'sinon';
import {
  Nock, SITE_CONFIG, createContext, createInfo,
} from '../utils.js';
import edit2web from '../../src/lookup/edit2web.js';

describe('edit2web Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('returns error when `editUrl` is malformed', async () => {
    const suffix = '/owner/sites/repo/status/page';

    const result = await edit2web(
      createContext(suffix),
      createInfo(suffix),
      'other',
    );
    assert.deepStrictEqual(result, {
      error: 'Unable to parse edit url: Invalid URL',
      status: 400,
    });
  });

  it('returns error when no handler is matching', async () => {
    const suffix = '/owner/sites/repo/status/page';
    const config = {
      ...SITE_CONFIG,
      content: {
        ...SITE_CONFIG.content,
        source: {
          type: 'unknown',
          url: 'https://www.example.com/',
        },
      },
    };

    const result = await edit2web(
      createContext(suffix, {
        attributes: {
          config,
        },
      }),
      createInfo(suffix),
      'https://www.example.com/',
    );
    assert.deepStrictEqual(result, {
      error: 'No handler found for document https://www.example.com/.',
      status: 404,
    });
  });
});
