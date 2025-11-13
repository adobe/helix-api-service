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

import assert from 'assert';
import path from 'path';
import { generate, querySiblingSites } from '../../src/discover/cdn-identifier.js';
import { createContext, createInfo, Nock } from '../utils.js';

describe('Discover CDN identifier tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('../../src/support/AdminContext.js')} */
  let context;

  beforeEach(() => {
    nock = new Nock().env();

    context = createContext('/org/sites/site/sitemap');
  });

  afterEach(() => {
    nock.done();
  });

  it('returns expected identifier', () => {
    const CDN_PROD_CONFIGS = [
      { type: 'akamai', endpoint: '1234', '#expected': 'akamai:1234' },
      { type: 'cloudflare', zoneId: '1234', '#expected': 'cloudflare:1234' },
      { type: 'cloudfront', distributionId: '1234', '#expected': 'cloudfront:1234' },
      { type: 'fastly', serviceId: '1234', '#expected': 'fastly:1234' },
      { type: 'managed', host: 'www.example.com', '#expected': 'managed:www.example.com' },
      {
        type: 'managed', host: 'www.example.com', envId: 'p1234-e5678', '#expected': 'managed:p1234-e5678',
      },
      { '#expected': null },
    ];
    CDN_PROD_CONFIGS.forEach((prod) => {
      assert.strictEqual(generate({ cdn: { prod } }), prod['#expected']);
    });
  });

  it('returns empty list when no inventory is found', async () => {
    nock.inventory()
      .reply(404);

    const entries = await querySiblingSites(context, {
      owner: 'owner', repo: 'repo',
    });
    assert.deepStrictEqual(entries, []);
  });

  describe('with a helix 5 inventory', () => {
    beforeEach(async () => {
      nock.inventory()
        .replyWithFile(200, path.resolve(__testdir, 'discover', 'fixtures', 'inventory-helix5.json'));
    });

    it('returns sibling sites for siteA', async () => {
      const info = createInfo('/org/sites/siteA/status/').withCode('owner', 'repo');
      const entries = await querySiblingSites(context, info);

      assert.deepStrictEqual(entries, [
        { org: 'org', site: 'siteB' },
        { org: 'org', site: 'siteC' },
      ]);
    });

    it('returns sibling sites for siteB', async () => {
      const info = createInfo('/org/sites/siteB/status/').withCode('owner', 'repo');
      const entries = await querySiblingSites(context, info);

      assert.deepStrictEqual(entries, [
        { org: 'org', site: 'siteA' },
        { org: 'org', site: 'siteC' },
      ]);
    });

    it('returns sibling sites for siteC', async () => {
      const info = createInfo('/org/sites/siteC/status/').withCode('owner', 'repo');
      const entries = await querySiblingSites(context, info);

      assert.deepStrictEqual(entries, [
        { org: 'org', site: 'siteA' },
      ]);
    });

    it('returns production sites for a site that has no production CDN configured', async () => {
      const info = createInfo('/org/sites/siteE/status/').withCode('owner', 'repo');
      const entries = await querySiblingSites(context, info);

      assert.deepStrictEqual(entries, [
        { org: 'org', site: 'siteA' },
        { org: 'org', site: 'siteC' },
      ]);
    });
  });
});
