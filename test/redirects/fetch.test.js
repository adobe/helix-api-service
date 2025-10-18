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
import { Nock, SITE_CONFIG } from '../utils.js';
import { AdminContext } from '../../src/support/AdminContext.js';
import fetchRedirects from '../../src/redirects/fetch.js';

describe('Redirects Fetch Tests', () => {
  const suffix = '/owner/sites/repo/status/index.md';
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function createContext(attributes = []) {
    return new AdminContext({
      log: console,
      pathInfo: { suffix },
    }, { attributes });
  }

  it('returns empty result when sheet is malformed', async () => {
    nock.content()
      .get('/preview/redirects.json')
      .query(true)
      .reply(200, {});

    const ret = await fetchRedirects(
      createContext({ config: SITE_CONFIG }),
      'preview',
    );
    assert.deepStrictEqual(ret, {});
  });

  it('returns redirects from sheet', async () => {
    nock.content()
      .get('/preview/redirects.json')
      .query(true)
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
      createContext({ config: SITE_CONFIG }),
      'preview',
    );
    assert.deepStrictEqual(ret, {
      '/index.md': '/other',
      '/other.md': 'bad-destination',
    });
  });

  it('throws on response status other than 404', async () => {
    nock.content()
      .get('/preview/redirects.json')
      .query(true)
      .reply(500);

    const ret = fetchRedirects(
      createContext({ config: SITE_CONFIG }),
      'preview',
    );
    await assert.rejects(
      ret,
      /error while loading redirects from [^:]+: 502/,
    );
  });
});
