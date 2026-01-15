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
import { createContext, Nock } from '../utils.js';

describe('Sitemap Language tests', () => {
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

  it('alternate with prefix and suffix', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, {
        data: [
          { path: '/path1' },
          { path: '/en/path2' },
          { path: '/en/path3/more' },
        ],
      });

    const language = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/en/query-index.json',
      hreflang: 'en',
      alternate: '/en/{path}/more',
      extension: '.html',
    }).init(context);

    const { slugs } = language;
    assert.deepStrictEqual([...slugs], [
      ['/path3', { loc: 'https://www.example.com/en/path3/more.html', path: '/en/path3/more' }],
    ]);
  });

  it('alternate without prefix', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, {
        data: [
          { path: '/path1' },
          { path: '/en/path2' },
          { path: '/en/path3/more' },
        ],
      });

    const language = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/en/query-index.json',
      hreflang: 'en',
      alternate: '{path}/more',
    }).init(context);

    const { slugs } = language;
    assert.deepStrictEqual([...slugs], [
      ['/en/path3', { loc: 'https://www.example.com/en/path3/more', path: '/en/path3/more' }],
    ]);
  });

  it('alternate without suffix', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, {
        data: [
          { path: '/path1' },
          { path: '/en/path2' },
          { path: '/en/path3/more' },
        ],
      });

    const language = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/en/query-index.json',
      hreflang: 'en',
      alternate: '/en/{path}',
    }).init(context);

    const { slugs } = language;
    assert.deepStrictEqual([...slugs], [
      ['/path2', { loc: 'https://www.example.com/en/path2', path: '/en/path2' }],
      ['/path3/more', { loc: 'https://www.example.com/en/path3/more', path: '/en/path3/more' }],
    ]);
  });

  it('alternate without prefix nor suffix', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, {
        data: [
          { path: 'path1' },
          { path: '/path2' },
        ],
      });

    const language = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/en/query-index.json',
      hreflang: 'en',
      alternate: '{path}',
    }).init(context);

    const { slugs } = language;
    assert.deepStrictEqual([...slugs], [
      ['path1', { loc: 'https://www.example.compath1', path: 'path1' }],
      ['/path2', { loc: 'https://www.example.com/path2', path: '/path2' }],
    ]);
  });

  it('alternate without {path} placeholder', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, {
        data: [
          { path: 'path1' },
          { path: '/path2' },
        ],
      });

    const language = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/en/query-index.json',
      hreflang: 'en',
      alternate: '/',
    }).init(context);

    const { slugs } = language;
    assert.deepStrictEqual([...slugs], []);
  });

  it('alternate missing, defaults to /{path}', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, {
        data: [
          { path: 'path1' },
          { path: '/path2' },
        ],
      });

    const language = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/en/query-index.json',
      hreflang: 'en',
    }).init(context);

    const { slugs } = language;
    assert.deepStrictEqual([...slugs], [
      ['/path2', { loc: 'https://www.example.com/path2', path: '/path2' }],
    ]);
  });

  it('primary language URL specified', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .reply(200, {
        data: [
          { path: '/de/willkommen', 'primary-language-url': '/welcome' },
          { path: '/de/ueber', 'primary-language-url': '/about' },
          { path: '/de/nur-hier' },
        ],
      });

    const language = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/en/query-index.json',
      hreflang: 'en',
    }).init(context);

    const { slugs } = language;
    assert.deepStrictEqual([...slugs], [
      ['/welcome', { loc: 'https://www.example.com/de/willkommen', path: '/de/willkommen' }],
      ['/about', { loc: 'https://www.example.com/de/ueber', path: '/de/ueber' }],
      ['/de/nur-hier', { loc: 'https://www.example.com/de/nur-hier', path: '/de/nur-hier' }],
    ]);
  });

  it('internal sitemap with neither sitemap nor default sheet', async () => {
    nock.content()
      .getObject('/live/query-index.json')
      .reply(200, JSON.stringify({
        news: {
          data: [
            { path: '/page1', lastModified: 1631031300, robots: '' },
          ],
        },
      }));

    const language = new SitemapLanguage({
      origin: 'https://www.origin.com',
      source: '/query-index.json',
    });
    await assert.rejects(() => language.init(context), /unable to find sheet 'sitemap' or 'default'/);
  });

  it('internal language sitemap with sheet selection', async () => {
    nock.content()
      .getObject('/live/query-index.json')
      .reply(200, JSON.stringify({
        'sitemap-de': {
          data: [
            { path: '/de/page1', lastModified: 1631031300, robots: '' },
            { path: '/bad/page2', lastModified: 1631031300, robots: '' },
            { path: '/de/page3', lastModified: 1631031300, robots: '' },
          ],
        },
      }));

    const language = await new SitemapLanguage({
      origin: 'https://www.origin.com',
      source: '/query-index.json?sheet=sitemap-de',
      hreflang: 'de',
      alternate: '/de/{path}',
    }).init(context);

    const { slugs } = language;
    assert.deepStrictEqual([...slugs], [
      ['/page1', { loc: 'https://www.origin.com/de/page1', path: '/de/page1' }],
      ['/page3', { loc: 'https://www.origin.com/de/page3', path: '/de/page3' }],
    ]);

    const locations = language.locations();
    assert.deepStrictEqual(locations, [
      'https://www.origin.com/de/page1',
      'https://www.origin.com/bad/page2',
      'https://www.origin.com/de/page3',
    ]);

    assert.strictEqual(language.getAlternateLocation('/page1'), 'https://www.origin.com/de/page1');
    assert.strictEqual(language.getAlternateLocation('/page2'), undefined);
    assert.strictEqual(language.getAlternateLocation('/page3'), 'https://www.origin.com/de/page3');

    language.addSelfAlternates();
    assert.strictEqual(language.toXML(), `  <url>
    <loc>https://www.origin.com/de/page1</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.origin.com/de/page1"/>
  </url>
  <url>
    <loc>https://www.origin.com/bad/page2</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.origin.com/bad/page2"/>
  </url>
  <url>
    <loc>https://www.origin.com/de/page3</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.origin.com/de/page3"/>
  </url>`);
  });

  it('internal language sitemap with invalid sheet selection', async () => {
    nock.content()
      .getObject('/live/query-index.json')
      .reply(200, JSON.stringify({
        'sitemap-de': {
          data: [
            { path: '/de/page1', lastModified: 1631031300, robots: '' },
            { path: '/bad/page2', lastModified: 1631031300, robots: '' },
            { path: '/de/page3', lastModified: 1631031300, robots: '' },
          ],
        },
      }));

    const language = new SitemapLanguage({
      origin: 'https://www.origin.com',
      source: '/query-index.json?sheet=sitemap-fr',
      hreflang: 'de',
      alternate: '/de/{path}',
    });
    await assert.rejects(async () => language.init(context), /sheet sitemap-fr not found$/);
  });

  it('external language sitemap', async () => {
    nock('https://www.example.com')
      .get('/it/sitemap.xml')
      .reply(200, `<?xml version="1.0" encoding="UTF-8" ?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/it/page1.html</loc>
    <lastmod>2022-08-25T10:59:05.128Z</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/it/page2.aspx</loc>
    <lastmod>2022-08-25T11:02:32.128Z</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/it/page3</loc>
    <lastmod>2022-08-24T11:05:47.011Z</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/other/page4.html</loc>
    <lastmod>2022-08-24T11:08:59.011Z</lastmod>
  </url>
</urlset>>`);

    const language = await new SitemapLanguage({
      origin: 'https://www.origin.com',
      source: 'https://www.example.com/it/sitemap.xml',
      hreflang: 'it',
      alternate: '/it/{path}',
    }).init(context);

    const { slugs } = language;
    assert.deepStrictEqual([...slugs], [
      ['/page1', { loc: 'https://www.origin.com/it/page1.html', path: '/it/page1.html' }],
      ['/page2', { loc: 'https://www.origin.com/it/page2.aspx', path: '/it/page2.aspx' }],
      ['/page3', { loc: 'https://www.origin.com/it/page3', path: '/it/page3' }],
    ]);

    const locations = language.locations();
    assert.deepStrictEqual(locations, [
      'https://www.origin.com/it/page1.html',
      'https://www.origin.com/it/page2.aspx',
      'https://www.origin.com/it/page3',
      'https://www.origin.com/other/page4.html',
    ]);

    assert.strictEqual(language.getAlternateLocation('/page1'), 'https://www.origin.com/it/page1.html');
    assert.strictEqual(language.getAlternateLocation('/page2'), 'https://www.origin.com/it/page2.aspx');
    assert.strictEqual(language.getAlternateLocation('/page3'), 'https://www.origin.com/it/page3');
    assert.strictEqual(language.getAlternateLocation('/page4'), undefined);

    language.addSelfAlternates();
    assert.strictEqual(language.toXML(), `  <url>
    <loc>https://www.origin.com/it/page1.html</loc>
    <xhtml:link rel="alternate" hreflang="it" href="https://www.origin.com/it/page1.html"/>
  </url>
  <url>
    <loc>https://www.origin.com/it/page2.aspx</loc>
    <xhtml:link rel="alternate" hreflang="it" href="https://www.origin.com/it/page2.aspx"/>
  </url>
  <url>
    <loc>https://www.origin.com/it/page3</loc>
    <xhtml:link rel="alternate" hreflang="it" href="https://www.origin.com/it/page3"/>
  </url>
  <url>
    <loc>https://www.origin.com/other/page4.html</loc>
    <xhtml:link rel="alternate" hreflang="it" href="https://www.origin.com/other/page4.html"/>
  </url>`);
  });

  it('language sitemap with duplicate paths', async () => {
    nock.content()
      .getObject('/live/de/query-index.json')
      .reply(200, JSON.stringify({
        sitemap: {
          data: [
            { path: '/de/page1', lastModified: 1631031300, robots: '' },
            { path: '/de/page2', lastModified: 1631131300, robots: '' },
            { path: '/de/page1', lastModified: 1631031300, robots: '' },
          ],
        },
      }));

    const language = await new SitemapLanguage({
      origin: 'https://www.origin.com',
      source: '/de/query-index.json',
      hreflang: 'de',
      alternate: '/de/{path}',
      lastmod: 'YYYY-MM-DD',
    }).init(context);

    const urls = language.urls().map(({ location, lastmod }) => ({ location, lastmod }));
    assert.deepStrictEqual(urls, [
      { location: 'https://www.origin.com/de/page1', lastmod: '2021-09-07' },
      { location: 'https://www.origin.com/de/page2', lastmod: '2021-09-08' },
    ]);
  });

  it('language sitemap with robots set in different case', async () => {
    nock.content()
      .getObject('/live/de/query-index.json')
      .reply(200, JSON.stringify({
        sitemap: {
          data: [
            { path: '/de/page1', lastModified: 1631031300 },
            { path: '/de/page2', lastModified: 1631131300, robots: 'noindex, nofollow' },
            { path: '/de/page3', lastModified: 1631031300, robots: 'nofollow, NoIndex' },
          ],
        },
      }));

    const language = await new SitemapLanguage({
      origin: 'https://www.origin.com',
      source: '/de/query-index.json',
      hreflang: 'de',
      alternate: '/de/{path}',
      lastmod: 'YYYY-MM-DD',
    }).init(context);

    const urls = language.urls().map(({ location, lastmod }) => ({ location, lastmod }));
    assert.deepStrictEqual(urls, [
      { location: 'https://www.origin.com/de/page1', lastmod: '2021-09-07' },
    ]);
  });

  it('language sitemap with different lastmodified values', async () => {
    nock.content()
      .getObject('/live/de/query-index.json')
      .reply(200, JSON.stringify({
        sitemap: {
          data: [
            { path: '/de/page1', lastModified: 1631031300, robots: '' },
            { path: '/de/page2', lastModified: 0, robots: '' },
            { path: '/de/page3', robots: '' },
            { path: '/de/page4', lastModified: 'Invalid Date', robots: '' },
          ],
        },
      }));

    const language = await new SitemapLanguage({
      origin: 'https://www.origin.com',
      source: '/de/query-index.json',
      hreflang: 'de',
      alternate: '/de/{path}',
      lastmod: 'YYYY-MM-DD',
    }).init(context);

    const xml = language.toXML();
    assert.deepStrictEqual(xml, `  <url>
    <loc>https://www.origin.com/de/page1</loc>
    <lastmod>2021-09-07</lastmod>
  </url>
  <url>
    <loc>https://www.origin.com/de/page2</loc>
    <lastmod>1970-01-01</lastmod>
  </url>
  <url>
    <loc>https://www.origin.com/de/page3</loc>
  </url>
  <url>
    <loc>https://www.origin.com/de/page4</loc>
  </url>`);
  });

  it('internal language sitemap with bad query index contents', async () => {
    nock.content()
      .getObject('/live/query-index.json')
      .reply(200, JSON.stringify({
        data: [
          { Column1: '/page', lastModified: 1631031300, robots: '' },
        ],
      }));

    const language = new SitemapLanguage({
      origin: 'https://www.origin.com',
      source: '/query-index.json',
      hreflang: 'en-US',
      alternate: '/{path}',
    });
    await assert.rejects(async () => language.init(context), /Some entries in \/query-index.json do not have a 'path' property$/);
  });

  it('partition large index into multiple sitemaps', async () => {
    nock.content()
      .getObject('/live/en/query-index.json')
      .times(2)
      .reply(200, {
        data: [
          { path: '/path1' },
          { path: '/path2' },
          { path: '/path3' },
        ],
      });

    const part1 = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/en/query-index.json?limit=2',
      hreflang: 'en',
    }).init(context);

    const part2 = await new SitemapLanguage({
      origin: 'https://www.example.com',
      source: '/en/query-index.json?offset=2&limit=2',
      hreflang: 'en',
    });
    await part2.init(context);

    assert.deepStrictEqual([...part1.slugs.keys()], ['/path1', '/path2']);
    assert.deepStrictEqual([...part2.slugs.keys()], ['/path3']);
  });

  it('sitemap with a non-matching canonical', async () => {
    nock.content()
      .getObject('/live/query-index.json')
      .reply(200, JSON.stringify({
        data: [
          { path: '/au/path1.html', lastModified: 1631031300 },
          { path: '/au/path2.html', lastModified: 1631031301, canonical: 'https://www.origin.com/en/path2.html' },
          { path: '/au/path3.html', lastModified: 1631031301, canonical: '' },
        ],
      }));

    const language = new SitemapLanguage({
      origin: 'https://www.origin.com',
      source: '/query-index.json',
      hreflang: 'en-AU',
      alternate: '/au/{path}.html',
    });
    await language.init(context);

    assert.deepStrictEqual(language.urls().map((url) => url.toString()), [
      'https://www.origin.com/au/path1.html',
      'https://www.origin.com/au/path3.html',
    ]);
  });
});
