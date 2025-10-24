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
import {
  Nock, SITE_CONFIG, createContext, createInfo,
} from '../utils.js';
import { getContentBusInfo } from '../../src/contentbus/contentbus.js';

describe('ContentBus Tests', () => {
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('adds `last-previewed` and `last-published` in snapshots', async () => {
    const suffix = '/owner/sites/repo/status/.snapshots/document';

    nock.content()
      .head('/preview/.snapshots/document.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const result = await getContentBusInfo(
      createContext(suffix),
      createInfo(suffix),
      'preview',
    );

    assert.deepStrictEqual(result, {
      contentBusId: 'helix-content-bus/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.snapshots/document.md',
      contentType: 'text/plain; charset=utf-8',
      lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      lastModifiedBy: undefined,
      lastPreviewed: undefined,
      lastPublished: undefined,
      redirectLocation: undefined,
      sheetNames: undefined,
      sourceLastModified: undefined,
      sourceLocation: 'google:*',
      status: 200,
    });
  });

  it('returns error if HEAD request for content fails', async () => {
    const suffix = '/owner/sites/repo/status/document';

    nock.content()
      .head('/live/document.md')
      .reply(403);

    const result = await getContentBusInfo(
      createContext(suffix),
      createInfo(suffix),
      'live',
    );

    assert.deepStrictEqual(result, {
      contentBusId: 'helix-content-bus/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/live/document.md',
      error: 'error while fetching: 403',
      status: 502,
    });
  });
});
