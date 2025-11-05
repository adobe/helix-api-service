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
/* eslint-disable no-param-reassign */
import assert from 'assert';
import sinon from 'sinon';
import { resolve } from 'path';
import { readFile } from 'fs/promises';
import { list } from '../../src/contentproxy/markup-list.js';
import {
  Nock, SITE_CONFIG, createContext, createInfo,
} from '../utils.js';

const SITE_MUP_CONFIG = (source, overlay) => {
  const config = {
    ...SITE_CONFIG,
    content: {
      ...SITE_CONFIG.content,
      source,
    },
  };
  if (overlay) {
    config.content.overlay = overlay;
  }
  return config;
};

function specPath(spec) {
  return resolve(__testdir, 'contentproxy', 'fixtures', spec);
}

describe('Markup Integration Tests (list)', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers(new Date('2024-01-01T00:00:00Z').getTime());
    nock = new Nock().env();
  });

  afterEach(() => {
    clock.restore();
    nock.done();
  });

  function setupTest(config) {
    const suffix = '/org/sites/site/contentproxy/';

    const context = createContext(suffix, {
      attributes: { config },
    });
    const info = createInfo(suffix).withCode('owner', 'repo');
    return { context, info };
  }

  it('Constructs list from paths (with mountpoint)', async () => {
    const config = SITE_MUP_CONFIG({
      url: 'https://byom.example.com',
      type: 'markup',
    });

    const { context, info } = setupTest(config);
    const result = await list(context, info, [
      '',
      '/',
      '/*',
      '/contact/',
      '/products/product-1',
      '/products/*',
      '/foo.pdf',
      '/foo.svg',
      '/foo.svg',
      '/foo/bar/baz.json',
      '/not-supported-content-type.bmp',
    ]);
    assert.deepStrictEqual(result, JSON.parse(await readFile(specPath('markup-list-result.json'))));
  });

  it('Constructs list from paths (with a markup mountpoint that contains multiple segments and ends in a slash)', async () => {
    const config = SITE_MUP_CONFIG({
      url: 'https://byom.example.com/abc/123/',
      type: 'markup',
    });

    const { context, info } = setupTest(config);
    const result = await list(context, info, [
      '',
      '/',
      '/*',
      '/contact/',
      '/products/product-1',
      '/products/*',
      '/foo.pdf',
      '/foo.svg',
      '/foo.svg',
      '/foo/bar/baz.json',
      '/not-supported-content-type.bmp',
    ]);
    assert.deepStrictEqual(result, JSON.parse(await readFile(specPath('markup-list-result-multi-segments.json'))));
  });

  it('Constructs list from paths (with overlay)', async () => {
    const config = SITE_MUP_CONFIG({
      url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog-s1',
      type: 'onedrive',
    }, {
      url: 'https://byom.example.com',
      type: 'markup',
    });

    const { context, info } = setupTest(config);
    const result = await list(context, info, [
      '',
      '/',
      '/*',
      '/contact/',
      '/products/product-1',
      '/products/*',
      '/foo.pdf',
      '/foo.svg',
      '/foo.svg',
      '/foo/bar/baz.json',
      '/not-supported-content-type.bmp',
    ]);
    assert.deepStrictEqual(result, JSON.parse(await readFile(specPath('markup-list-result.json'))));
  });

  it('Constructs list from paths with both a markup primary content source and an overlay', async () => {
    const config = SITE_MUP_CONFIG({
      url: 'https://byom.example.com',
      type: 'markup',
    }, {
      url: 'https://byom-overlay.example.com',
      type: 'markup',
    });

    const { context, info } = setupTest(config);
    const result = await list(context, info, [
      '',
      '/',
      '/contact/',
      '/products/product-1',
      '/products/*',
      '/foo.pdf',
      '/foo.svg',
      '/foo.svg',
      '/foo/bar/baz.json',
      '/not-supported-content-type.bmp',
    ]);
    assert.deepStrictEqual(result, JSON.parse(await readFile(specPath('markup-list-result-overlay.json'))));
  });
});
