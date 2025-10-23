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
import { Nock } from '../utils.js';
import { computeSourceUrl, getSheetData } from '../../src/contentproxy/utils.js';

describe('ContentProxy Utils Tests', () => {
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('tests `getSheetData`', () => {
    assert.deepStrictEqual(getSheetData({
      custom: {
        data: [],
      },
    }, ['custom']), []);
  });

  it('tests `computeSourceUrl`', async () => {
    await assert.rejects(
      () => computeSourceUrl(null, null, {
        url: 'nope',
      }),
      /Bad mountpoint URL in fstab/,
    );

    const contentSource = {
      type: 'markup',
      url: 'https://content.da.live/org/site/',
      suffix: '/?a=1&b=2',
    };
    const { href } = await computeSourceUrl(null, {
      resourcePath: '/index.md',
      ext: '.md',
    }, contentSource);
    assert.strictEqual(href, 'https://content.da.live/org/site/index/?a=1&b=2');
  });
});
