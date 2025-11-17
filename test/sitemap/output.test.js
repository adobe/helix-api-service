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

import SitemapLanguage from '../../src/sitemap/language.js';
import SitemapOutput from '../../src/sitemap/output.js';
import { createContext, Nock } from '../utils.js';

describe('Sitemap Output tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  const suffix = '/org/sites/site/sitemap/';

  it('add language that provides too many URLs', async () => {
    nock.content()
      .getObject('/live/query-index.json')
      .reply(200, {
        data: Array.from({ length: 50001 }, (_, index) => ({ path: `/path-${index + 1}` })),
      });

    const context = createContext(suffix);
    const language = new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/query-index.json',
    });
    await language.init(context);

    const output = new SitemapOutput('/sitemap.xml');
    output.addLanguage(language);

    await assert.rejects(
      async () => output.changed(context),
      /Error: language sitemap source \/query-index.json contains more than 50000 entries: 50001/,
    );
    assert.throws(
      () => output.checkLimit(),
      /Error: language sitemap source \/query-index.json contains more than 50000 entries: 50001/,
    );
  });

  it('add multiple languages that provide too many URLs in total', async () => {
    nock.content()
      .getObject('/live/de/query-index.json')
      .reply(200, {
        data: Array.from({ length: 25001 }, (_, index) => ({ path: `/de/path-${index + 1}` })),
      })
      .getObject('/live/en/query-index.json')
      .reply(200, {
        data: Array.from({ length: 25000 }, (_, index) => ({ path: `/en/path-${index + 1}` })),
      });

    const context = createContext(suffix);
    const en = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/en/query-index.json',
    }).init(context);
    const de = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/de/query-index.json',
    }).init(context);

    const output = new SitemapOutput('/sitemap.xml');
    output.addLanguage(en);
    output.addLanguage(de);

    await assert.rejects(
      () => output.changed(context),
      /Error: destination sitemap \/sitemap.xml contains more than 50000 entries: 50001/,
    );
    assert.throws(
      () => output.checkLimit(),
      /Error: destination sitemap \/sitemap.xml contains more than 50000 entries: 50001/,
    );
  });
});
