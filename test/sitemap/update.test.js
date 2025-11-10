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
import zlib from 'zlib';
import sitemap, { rebuildSitemap } from '../../src/sitemap/update.js';
import {
  createInfo, createContext, Nock, SITE_CONFIG, ORG_CONFIG,
} from '../utils.js';

const SITEMAP_CONFIG = `
version: 1
sitemaps:
  simple:
    source: /query-index.json
    destination: /sitemap.xml
  simple-with-lastmod:
    origin: https://www.example.com
    source: /query-index-with-lastmod.json
    destination: /sitemap.xml
    lastmod: YYYY-MM-DD
    extension: .html
  multiple:
    origin: https://www.example.com
    default: en
    languages:
      de:
        source: /de/query-index.json
        destination: /de/sitemap.xml
        hreflang: de
        alternate: /de/{path}
      en:
        source: /en/query-index.json
        destination: /en/sitemap.xml
        hreflang:
          - en
          - en-US
      it:
        source: https://www.example.com/it/sitemap.xml
        destination: /it/sitemap.xml
        hreflang: it
        alternate: /it/{path}
  aggregated:
    origin: https://www.example.com
    lastmod: YYYY-MM-DD
    languages:
      dk:
        source: /dk/query-index.json
        destination: /sitemap.xml
        hreflang: dk
        alternate: /dk/{path}
      no:
        source: /no/query-index.json
        destination: /sitemap.xml
        hreflang: no
        alternate: /no/{path}
        extension: .html
  multisheet-first:
    origin: https://www.example.com
    source: /other/query-index.json?sheet=first
    destination: /first-sitemap.xml
  multisheet-second:
    origin: https://www.example.com
    source: /other/query-index.json?sheet=second
    destination: /second-sitemap.xml
`;

const INDEX_JSON = {
  default: {
    data: [
      { path: '/page1', lastModified: 1631031300, robots: '' },
      { path: '/page2', lastModified: 1631031301 },
      { path: '/page3', lastModified: 1631031301, robots: 'noindex' },
      { path: '/page4', lastModified: 1631031301, robots: 'nofollow, NoIndex' },
    ],
  },
  sitemap: {
    data: [
      { path: '/page1', lastModified: 1631031300, robots: '' },
    ],
  },
};

const ENV = {
  HELIX_STORAGE_DISABLE_R2: 'true',
};

describe('Sitemap update tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  describe('source change tests', () => {
    const suffix = '/org/sites/site/sitemap/';

    function setupTest(sitemapConfig = SITEMAP_CONFIG) {
      nock.sitemapConfig(sitemapConfig);

      const context = createContext(suffix, { env: ENV });
      const info = createInfo(suffix).withCode('owner', 'repo');
      return { context, info };
    }

    it('adds new sitemap to content-bus (simple data)', async () => {
      const reqs = {};

      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify(INDEX_JSON.default))
        .getObject('/live/sitemap.xml')
        .reply(404)
        .put(/.*\?x-id=PutObject/)
        .twice()
        .reply((uri, body) => {
          reqs[uri.split('?')[0]] = {
            body: zlib.gunzipSync(Buffer.from(body, 'hex')).toString(),
          };
          return [200];
        });

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/query-index.json', updatePreview: true,
      });

      assert.strictEqual(resp.status, 200);
      const result = await resp.json();
      assert.deepStrictEqual(result.paths, ['/sitemap.xml']);

      const { contentBusId } = context;
      assert.deepStrictEqual(reqs, {
        [`/${contentBusId}/live/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/page1</loc>
  </url>
  <url>
    <loc>https://www.example.com/page2</loc>
  </url>
</urlset>
`,
        },
        [`/${contentBusId}/preview/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/page1</loc>
  </url>
  <url>
    <loc>https://www.example.com/page2</loc>
  </url>
</urlset>
`,
        },
      });
    });

    it('adds new sitemap to content-bus (simple data) with lastmod', async () => {
      const reqs = {};

      nock.content()
        .getObject('/live/query-index-with-lastmod.json')
        .reply(200, JSON.stringify({
          data: [
            { path: '/page1', lastModified: 1631031300, robots: '' },
            { path: '/home/', lastModified: 1631031300, robots: '' },
          ],
        }))
        .getObject('/live/sitemap.xml')
        .reply(200, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/page1.html</loc>
    <lastmod>2022-08-25</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/home/</loc>
    <lastmod>2022-08-25</lastmod>
  </url>
</urlset>
`)
        .put(/.*\?x-id=PutObject/)
        .once()
        .reply((uri, body) => {
          reqs[uri.split('?')[0]] = {
            body: zlib.gunzipSync(Buffer.from(body, 'hex')).toString(),
          };
          return [200];
        });

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/query-index-with-lastmod.json',
      });
      assert.strictEqual(resp.status, 200);
      const result = await resp.json();
      assert.deepStrictEqual(result.paths, ['/sitemap.xml']);
      assert.deepStrictEqual(reqs, {
        [`/${context.contentBusId}/live/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/page1.html</loc>
    <lastmod>2021-09-07</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/home/</loc>
    <lastmod>2021-09-07</lastmod>
  </url>
</urlset>
`,
        },
      });
    });

    it('adds new sitemap to content-bus (default sheet)', async () => {
      const reqs = {};

      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify({ default: INDEX_JSON.default }))
        .getObject('/live/sitemap.xml')
        .reply(200, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/page2</loc>
  </url>
</urlset>
`)
        .put(/.*\?x-id=PutObject/)
        .reply((uri, body) => {
          reqs[uri.split('?')[0]] = {
            body: zlib.gunzipSync(Buffer.from(body, 'hex')).toString(),
          };
          return [200];
        });

      const { context, info } = setupTest();
      await sitemap.sourceChanged(context, info, {
        source: '/query-index.json',
      });

      assert.deepStrictEqual(reqs, {
        [`/${context.contentBusId}/live/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/page1</loc>
  </url>
  <url>
    <loc>https://www.example.com/page2</loc>
  </url>
</urlset>
`,
        },
      });
    });

    it('adds new sitemap to content-bus (sitemap sheet)', async () => {
      const reqs = {};

      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify(INDEX_JSON))
        .getObject('/live/sitemap.xml')
        .reply(200, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/page2</loc>
  </url>
</urlset>
`)
        .put(/.*\?x-id=PutObject/)
        .reply((uri, body) => {
          reqs[uri.split('?')[0]] = {
            body: zlib.gunzipSync(Buffer.from(body, 'hex')).toString(),
          };
          return [200];
        });

      const { context, info } = setupTest();
      await sitemap.sourceChanged(context, info, {
        source: '/query-index.json',
      });

      assert.deepStrictEqual(reqs, {
        [`/${context.contentBusId}/live/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/page1</loc>
  </url>
</urlset>
`,
        },
      });
    });

    it('adds multiple language sitemap to content-bus', async () => {
      const reqs = {};

      nock.content()
        .getObject('/live/en/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/', lastModified: 1631031300, robots: '' },
              { path: '/page1', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/de/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/de/', lastModified: 1631031300, robots: '' },
              { path: '/de/page1', lastModified: 1631031300, robots: '' },
              { path: '/bad/page2', lastModified: 1631031300, robots: '' },
              { path: '/de/page3', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/de/sitemap.xml')
        .reply(404)
        .put(/.*\?x-id=PutObject/)
        .times(3)
        .reply((uri, body) => {
          reqs[uri.split('?')[0]] = {
            body: zlib.gunzipSync(Buffer.from(body, 'hex')).toString(),
          };
          return [200];
        });
      nock('https://www.example.com')
        .get('/it/sitemap.xml')
        .reply(200, `<?xml version="1.0" encoding="UTF-8" ?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/it/page1.html</loc>
    <lastmod>2022-08-25T10:59:05.128Z</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/it/page3.html</loc>
    <lastmod>2022-08-24T11:05:47.011Z</lastmod>
  </url>
</urlset>>`);

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/de/query-index.json',
      });

      assert.strictEqual(resp.status, 200);
      const result = await resp.json();
      assert.deepStrictEqual(result.paths.sort(), ['/de/sitemap.xml', '/en/sitemap.xml', '/it/sitemap.xml']);

      const { contentBusId } = context;
      assert.deepStrictEqual(reqs, {
        [`/${contentBusId}/live/en/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/"/>
    <xhtml:link rel="alternate" hreflang="en-US" href="https://www.example.com/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.example.com/"/>
  </url>
  <url>
    <loc>https://www.example.com/page1</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/page1"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/page1"/>
    <xhtml:link rel="alternate" hreflang="en-US" href="https://www.example.com/page1"/>
    <xhtml:link rel="alternate" hreflang="it" href="https://www.example.com/it/page1.html"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.example.com/page1"/>
  </url>
</urlset>
`,
        },
        [`/${contentBusId}/live/de/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/de/</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/"/>
    <xhtml:link rel="alternate" hreflang="en-US" href="https://www.example.com/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.example.com/"/>
  </url>
  <url>
    <loc>https://www.example.com/de/page1</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/page1"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/page1"/>
    <xhtml:link rel="alternate" hreflang="en-US" href="https://www.example.com/page1"/>
    <xhtml:link rel="alternate" hreflang="it" href="https://www.example.com/it/page1.html"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.example.com/page1"/>
  </url>
  <url>
    <loc>https://www.example.com/bad/page2</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/bad/page2"/>
  </url>
  <url>
    <loc>https://www.example.com/de/page3</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/page3"/>
    <xhtml:link rel="alternate" hreflang="it" href="https://www.example.com/it/page3.html"/>
  </url>
</urlset>
`,
        },
        [`/${contentBusId}/live/it/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/it/page1.html</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/page1"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/page1"/>
    <xhtml:link rel="alternate" hreflang="en-US" href="https://www.example.com/page1"/>
    <xhtml:link rel="alternate" hreflang="it" href="https://www.example.com/it/page1.html"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.example.com/page1"/>
  </url>
  <url>
    <loc>https://www.example.com/it/page3.html</loc>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/page3"/>
    <xhtml:link rel="alternate" hreflang="it" href="https://www.example.com/it/page3.html"/>
  </url>
</urlset>
`,
        },
      });
    });

    it('handles multiple language sitemap, having both alternate and primary language url', async () => {
      const reqs = {};

      const sitemapConfig = `
sitemaps:
  multiple:
    origin: https://www.example.com
    languages:
      en:
        source: /en/query-index.json
        destination: /en/sitemap.xml
        hreflang: en
        alternate: /en/{path}
      de:
        source: /de/query-index.json
        destination: /de/sitemap.xml
        hreflang: de
        alternate: /de/{path}
`;

      nock.content()
        .getObject('/live/en/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/en/' },
              { path: '/en/welcome' },
            ],
          },
        }))
        .getObject('/live/de/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/de/' },
              { path: '/de/willkommen', 'primary-language-url': '/en/welcome' },
            ],
          },
        }))
        .getObject('/live/de/sitemap.xml')
        .reply(404)
        .put(/.*\?x-id=PutObject/)
        .times(2)
        .reply((uri, body) => {
          reqs[uri.split('?')[0]] = {
            body: zlib.gunzipSync(Buffer.from(body, 'hex')).toString(),
          };
          return [200];
        });

      const { context, info } = setupTest(sitemapConfig);
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/de/query-index.json',
      });
      assert.strictEqual(resp.status, 200);
      const result = await resp.json();
      assert.deepStrictEqual(result.paths.sort(), ['/de/sitemap.xml', '/en/sitemap.xml']);

      const { contentBusId } = context;
      assert.deepStrictEqual(reqs, {
        [`/${contentBusId}/live/de/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/de/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/en/"/>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/"/>
  </url>
  <url>
    <loc>https://www.example.com/de/willkommen</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/en/welcome"/>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/willkommen"/>
  </url>
</urlset>
`,
        },
        [`/${contentBusId}/live/en/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/en/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/en/"/>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/"/>
  </url>
  <url>
    <loc>https://www.example.com/en/welcome</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.example.com/en/welcome"/>
    <xhtml:link rel="alternate" hreflang="de" href="https://www.example.com/de/willkommen"/>
  </url>
</urlset>
`,
        },
      });
    });

    it('adds aggregated sitemap to content-bus', async () => {
      const reqs = {};

      nock.content()
        .getObject('/live/dk/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/dk/page1', lastModified: 1631031300, robots: '' },
              { path: '/dk/page2', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/no/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/no/page1', lastModified: 1631031300, robots: '' },
              { path: '/bad/page2', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/sitemap.xml')
        .reply(404)
        .put(/.*\?x-id=PutObject/)
        .reply((uri, body) => {
          reqs[uri.split('?')[0]] = {
            body: zlib.gunzipSync(Buffer.from(body, 'hex')).toString(),
          };
          return [200];
        });

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/no/query-index.json',
      });
      assert.strictEqual(resp.status, 200);
      const result = await resp.json();
      assert.deepStrictEqual(result.paths, ['/sitemap.xml']);

      assert.deepStrictEqual(reqs, {
        [`/${context.contentBusId}/live/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/dk/page1</loc>
    <lastmod>2021-09-07</lastmod>
    <xhtml:link rel="alternate" hreflang="dk" href="https://www.example.com/dk/page1"/>
    <xhtml:link rel="alternate" hreflang="no" href="https://www.example.com/no/page1.html"/>
  </url>
  <url>
    <loc>https://www.example.com/dk/page2</loc>
    <lastmod>2021-09-07</lastmod>
    <xhtml:link rel="alternate" hreflang="dk" href="https://www.example.com/dk/page2"/>
  </url>
  <url>
    <loc>https://www.example.com/no/page1.html</loc>
    <lastmod>2021-09-07</lastmod>
    <xhtml:link rel="alternate" hreflang="dk" href="https://www.example.com/dk/page1"/>
    <xhtml:link rel="alternate" hreflang="no" href="https://www.example.com/no/page1.html"/>
  </url>
  <url>
    <loc>https://www.example.com/bad/page2.html</loc>
    <lastmod>2021-09-07</lastmod>
    <xhtml:link rel="alternate" hreflang="no" href="https://www.example.com/bad/page2.html"/>
  </url>
</urlset>
`,
        },
      });
    });

    it('handles multi-sheet', async () => {
      const reqs = {};

      nock.content()
        .getObject('/live/other/query-index.json')
        .twice()
        .reply(200, JSON.stringify({
          first: {
            data: [
              { path: '/first/page1', lastModified: 1631031300, robots: '' },
              { path: '/first/page2', lastModified: 1631031300, robots: '' },
            ],
          },
          second: {
            data: [
              { path: '/second/page1', lastModified: 1631031300, robots: '' },
              { path: '/second/page2', lastModified: 1631031300, robots: '' },
              { path: '/second/page3', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/first-sitemap.xml')
        .reply(200, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/first/page1</loc>
  </url>
  <url>
    <loc>https://www.example.com/first/page2</loc>
  </url>
</urlset>
`)
        .getObject('/live/second-sitemap.xml')
        .reply(200, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url>
<loc>https://www.example.com/second/page1</loc>
</url>
<url>
<loc>https://www.example.com/second/page2</loc>
</url>
</urlset>
`)
        .put(/.*\?x-id=PutObject/)
        .reply((uri, body) => {
          reqs[uri.split('?')[0]] = {
            body: zlib.gunzipSync(Buffer.from(body, 'hex')).toString(),
          };
          return [200];
        });

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/other/query-index.json',
      });
      assert.strictEqual(resp.status, 200);
      const result = await resp.json();
      assert.deepStrictEqual(result.paths, ['/second-sitemap.xml']);

      assert.deepStrictEqual(reqs, {
        [`/${context.contentBusId}/live/second-sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/second/page1</loc>
  </url>
  <url>
    <loc>https://www.example.com/second/page2</loc>
  </url>
  <url>
    <loc>https://www.example.com/second/page3</loc>
  </url>
</urlset>
`,
        },
      });
    });

    it('supports internal sitemap', async () => {
      nock.content()
        .head('/live/sitemap.json')
        .reply(200);

      const { context, info } = setupTest(null);
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/sitemap.json',
      });
      assert.strictEqual(resp.status, 200);
      const result = await resp.json();
      assert.deepStrictEqual(result.paths, ['/sitemap.xml']);
    });

    it('handles `builder.changed()` causing error', async () => {
      nock.content()
        .getObject('/live/de/query-index.json')
        .reply(500);

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/de/query-index.json',
      });
      assert.strictEqual(resp.status, 204);
    });

    it('handles `builder.build()` causing error', async () => {
      nock.content()
        .getObject('/live/en/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/page1', lastModified: 1631031300, robots: '' },
              { path: '/de/page1', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/de/query-index.json')
        .reply(500)
        .getObject('/live/en/sitemap.xml')
        .reply(404);
      nock('https://www.example.com')
        .get('/it/sitemap.xml')
        .reply(200, `<?xml version="1.0" encoding="UTF-8" ?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/it/page1.html</loc>
    <lastmod>2022-08-25T10:59:05.128Z</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/it/page3.html</loc>
    <lastmod>2022-08-24T11:05:47.011Z</lastmod>
  </url>
</urlset>>`);

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/en/query-index.json',
      });
      assert.strictEqual(resp.status, 502);
    });

    it('handles fetching external sitemap causing error', async () => {
      nock.content()
        .getObject('/live/en/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/page1', lastModified: 1631031300, robots: '' },
              { path: '/de/page1', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/de/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/de/page1', lastModified: 1631031300, robots: '' },
              { path: '/bad/page2', lastModified: 1631031300, robots: '' },
              { path: '/de/page3', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/en/sitemap.xml')
        .reply(404);
      nock('https://www.example.com')
        .get('/it/sitemap.xml')
        .reply(404, 'Not found');

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/en/query-index.json',
      });
      assert.strictEqual(resp.status, 404);
      assert.match(
        resp.headers.get('x-error'),
        /Building sitemap failed: Unable to fetch external sitemap .+: Not found$/,
      );
    });

    it('handles fetching external sitemap causing a timeout', async () => {
      nock.content()
        .getObject('/live/en/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/page1', lastModified: 1631031300, robots: '' },
              { path: '/de/page1', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/de/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/de/page1', lastModified: 1631031300, robots: '' },
              { path: '/bad/page2', lastModified: 1631031300, robots: '' },
              { path: '/de/page3', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/en/sitemap.xml')
        .reply(404);
      nock('https://www.example.com')
        .get('/it/sitemap.xml')
        .delayConnection(100)
        .reply(404);

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/en/query-index.json', fetchTimeout: 1,
      });
      assert.strictEqual(resp.status, 500);
      assert.match(resp.headers.get('x-error'), /The operation was aborted.$/);
    });

    it('handles parsing external sitemap causing error', async () => {
      nock.content()
        .getObject('/live/en/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/page1', lastModified: 1631031300, robots: '' },
              { path: '/de/page1', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/de/query-index.json')
        .reply(200, JSON.stringify({
          sitemap: {
            data: [
              { path: '/de/page1', lastModified: 1631031300, robots: '' },
              { path: '/bad/page2', lastModified: 1631031300, robots: '' },
              { path: '/de/page3', lastModified: 1631031300, robots: '' },
            ],
          },
        }))
        .getObject('/live/en/sitemap.xml')
        .reply(404);
      nock('https://www.example.com')
        .get('/it/sitemap.xml')
        .reply(200, `<?xml version="1.0" encoding="UTF-8" ?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/it/page1.html</loc>
    <lastmod>2022-08-25T10:59:05.128Z</lastmod>
  </url>
  <url>
    <loc>https://www.example.com/it/page3.html</loc>
    <lastmod>2022-08-24T11:05:47.011Z</lastmod>
  </url>
<//urlset>>`);

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/en/query-index.json',
      });
      assert.strictEqual(resp.status, 500);
    });

    it('handles existing sitemap that did not change', async () => {
      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify(INDEX_JSON))
        .getObject('/live/sitemap.xml')
        .reply(200, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.com/page1</loc>
  </url>
</urlset>
`);
      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/query-index.json',
      });
      assert.strictEqual(resp.status, 204);
    });

    it('handles existing sitemap that has no URLs', async () => {
      let contents;

      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify(INDEX_JSON))
        .getObject('/live/sitemap.xml')
        .reply(200, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>
`)
        .putObject('/live/sitemap.xml')
        .reply((_, body) => {
          contents = zlib.gunzipSync(Buffer.from(body, 'hex')).toString();
          return [200];
        });
      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/query-index.json',
      });
      assert.strictEqual(resp.status, 200);
      assert.deepStrictEqual(contents, `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/page1</loc>
  </url>
</urlset>
`);
    });

    it('handles missing helix-sitemap.yaml', async () => {
      nock.content()
        .head('/live/sitemap.json')
        .reply(404);

      const { context, info } = setupTest(null);
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/query-index.json',
      });
      assert.strictEqual(resp.status, 404);
    });

    it('handles source not matching any sitemap source', async () => {
      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/something-else.json',
      });
      assert.strictEqual(resp.status, 204);
    });

    it('handles existing sitemap causing error', async () => {
      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify(INDEX_JSON))
        .getObject('/live/sitemap.xml')
        .reply(500);

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/query-index.json',
      });
      assert.strictEqual(resp.status, 500);
    });

    it('handles errors from content-bus while updating', async () => {
      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify(INDEX_JSON))
        .getObject('/live/sitemap.xml')
        .reply(404)
        .putObject('/live/sitemap.xml')
        .reply(403);

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/query-index.json',
      });
      assert.strictEqual(resp.status, 500);
    });

    it('handles errors from content-bus while updating preview', async () => {
      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify(INDEX_JSON))
        .getObject('/live/sitemap.xml')
        .reply(404)
        .putObject('/live/sitemap.xml')
        .reply(200)
        .putObject('/preview/sitemap.xml')
        .reply(403);

      const { context, info } = setupTest();
      const resp = await sitemap.sourceChanged(context, info, {
        source: '/query-index.json', updatePreview: true,
      });
      assert.strictEqual(resp.status, 500);
    });
  });

  describe('rebuild sitemap tests', () => {
    function setupTest(sitemapConfig = SITEMAP_CONFIG, path = '/sitemap.xml') {
      nock.sitemapConfig(sitemapConfig);

      const suffix = `/org/sites/site/sitemap${path}`;
      const context = createContext(suffix, { env: ENV });
      const info = createInfo(suffix).withCode('owner', 'repo');
      return { context, info };
    }

    it('adds new sitemap to content-bus (simple data) given the destination path', async () => {
      const reqs = {};

      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify(INDEX_JSON.default))
        .put(/.*\?x-id=PutObject/)
        .once()
        .reply((uri, body) => {
          reqs[uri.split('?')[0]] = {
            body: zlib.gunzipSync(Buffer.from(body, 'hex')).toString(),
          };
          return [200];
        });

      const { context, info } = setupTest();
      const resp = await rebuildSitemap(context, info);
      assert.strictEqual(resp.status, 200);

      const result = await resp.json();
      assert.deepStrictEqual(result.paths, ['/sitemap.xml']);

      assert.deepStrictEqual(reqs, {
        [`/${context.contentBusId}/live/sitemap.xml`]: {
          body: `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://www.example.com/page1</loc>
  </url>
  <url>
    <loc>https://www.example.com/page2</loc>
  </url>
</urlset>
`,
        },
      });
    });

    it('supports internal sitemap', async () => {
      nock.content()
        .head('/live/sitemap.json')
        .reply(200);

      const { context, info } = setupTest(null);
      const resp = await rebuildSitemap(context, info);
      assert.strictEqual(resp.status, 200);

      const result = await resp.json();
      assert.deepStrictEqual(result.paths, ['/sitemap.xml']);
    });

    it('handles destination not matching any sitemap destination', async () => {
      const { context, info } = setupTest(SITEMAP_CONFIG, '/something_else.xml');
      const resp = await rebuildSitemap(context, info);
      assert.strictEqual(resp.status, 204);
    });

    it('handles external sitemap with a bad URL', async () => {
      const sitemapConfig = `sitemaps:
    simple:
      origin: https://www.example.com
      source: /external/sitemap.xml
      destination: /sitemap.xml
    `;

      const { context, info } = setupTest(sitemapConfig);
      const resp = await rebuildSitemap(context, info);
      assert.strictEqual(resp.status, 400);
    });

    it('handles external sitemap with a URL that has not https protocol', async () => {
      const sitemapConfig = `sitemaps:
    simple:
      origin: https://www.example.com
      source: http://localhost/sitemap.xml
      destination: /sitemap.xml
    `;

      const { context, info } = setupTest(sitemapConfig);
      const resp = await rebuildSitemap(context, info);
      assert.strictEqual(resp.status, 400);
    });

    it('handles external sitemap with a URL that has custom port', async () => {
      const sitemapConfig = `sitemaps:
    simple:
      origin: https://www.example.com
      source: https://localhost:1234/sitemap.xml
      destination: /sitemap.xml
    `;

      const { context, info } = setupTest(sitemapConfig);
      const resp = await rebuildSitemap(context, info);
      assert.strictEqual(resp.status, 400);
    });

    it('handles missing helix-sitemap.yaml', async () => {
      nock.content()
        .head('/live/sitemap.json')
        .reply(404);

      const { context, info } = setupTest(null);
      const resp = await rebuildSitemap(context, info);
      assert.strictEqual(resp.status, 404);
    });

    it('handles errors from content bus while updating', async () => {
      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify(INDEX_JSON))
        .putObject('/live/sitemap.xml')
        .reply(403);

      const { context, info } = setupTest();
      const resp = await rebuildSitemap(context, info);
      assert.strictEqual(resp.status, 500);
    });
  });
});
