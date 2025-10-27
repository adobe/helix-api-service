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
import fetchRedirects from '../../src/redirects/fetch.js';
import { Nock, createContext } from '../utils.js';

describe('Redirects Fetch Tests', () => {
  const suffix = '/owner/sites/repo/status/index.md';

  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('returns empty result when sheet is malformed', async () => {
    nock.content()
      .getObject('/preview/redirects.json')
      .reply(200, {});

    const ret = await fetchRedirects(
      createContext(suffix),
      'preview',
    );
    assert.deepStrictEqual(ret, {});
  });

  it('returns redirects from sheet', async () => {
    nock.content()
      .getObject('/preview/redirects.json')
      .reply(200, {
        data: [{
          source: '/', destination: '/other',
        }, {
          destination: '/missing-source',
        }, {
          source: '/missing-destination',
        }, {
          source: '/other', destination: 'bad-destination',
        }],
      });

    const ret = await fetchRedirects(
      createContext(suffix),
      'preview',
    );
    assert.deepStrictEqual(ret, {
      '/index.md': '/other',
      '/other.md': 'bad-destination',
    });
  });

  it('throws on response status other than 404', async () => {
    nock.content()
      .getObject('/preview/redirects.json')
      .reply(500);

    const ret = fetchRedirects(
      createContext(suffix),
      'preview',
    );
    await assert.rejects(
      ret,
      /error while loading redirects from [^:]+: 502/,
    );
  });
});
