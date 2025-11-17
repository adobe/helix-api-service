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
import { SitemapConfig } from '@adobe/helix-shared-config';
import {
  fetchExtendedSitemap, getDestinations,
  hasSimpleSitemap, installSimpleSitemap,
} from '../../src/sitemap/utils.js';
import { createInfo, createContext, Nock } from '../utils.js';

const ENV = {
  HELIX_STORAGE_DISABLE_R2: 'true',
};

describe('Sitemap Utils', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(sitemapConfig) {
    nock.sitemapConfig(sitemapConfig);

    const suffix = '/org/sites/site/sitemap/';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo');
    return { context, info };
  }

  it('get destinations', async () => {
    const config = await new SitemapConfig().withSource(`
sitemaps:
  default:
    lastmod: YYYY-MM-DD
    languages:
      en:
        source: /query-index.json
        destination: /sitemap.xml
        hreflang: en
      de:
        source: /de/query-index.json
        destination: /sitemap.xml
        hreflang: de
  other:
    source: /other-query-index.json
    destination: /other-sitemap.xml
`).init();
    const destinations = getDestinations(config);
    assert.deepStrictEqual(destinations, [
      '/sitemap.xml',
      '/other-sitemap.xml',
    ]);
  });

  it('works with empty configuration', async () => {
    const config = await new SitemapConfig().withSource('').init();
    const destinations = getDestinations(config);
    assert.deepStrictEqual(destinations, []);
  });

  it('works with missing configuration', async () => {
    const destinations = getDestinations(null);
    assert.deepStrictEqual(destinations, []);
  });

  it('returns false for installing simple sitemap when sitemap is invalid', async () => {
    const sitemapConfig = 'sitemaps:';

    const { context, info } = setupTest(sitemapConfig);
    const ret = await installSimpleSitemap(context, info);
    assert.strictEqual(ret, false);
  });

  it('returns false for getting simple sitemap when sitemap is invalid', async () => {
    const sitemapConfig = 'sitemaps:';

    const { context, info } = setupTest(sitemapConfig);
    const ret = await hasSimpleSitemap(context, info);
    assert.strictEqual(ret, false);
  });

  it('adds simple sitemap configuration when helix-sitemap.yaml is missing', async () => {
    nock.content()
      .head('/live/sitemap.json')
      .reply(200);

    const { context, info } = setupTest(null);
    const config = await fetchExtendedSitemap(context, info);
    assert.notStrictEqual(config, null);

    const { sitemaps } = config;
    assert.strictEqual(sitemaps.length, 1);
    assert.strictEqual(sitemaps[0].name, '#internal-sitemap');
  });

  it('returns null for extended sitemap when sitemap is invalid', async () => {
    const sitemapConfig = 'sitemaps:';

    const { context, info } = setupTest(sitemapConfig);
    await assert.rejects(
      () => fetchExtendedSitemap(context, info),
      /Invalid sitemap configuration/,
    );
  });
});
