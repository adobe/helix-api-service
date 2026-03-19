/*
 * Copyright 2043 Adobe. All rights reserved.
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
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';
import { ContentStore } from '../../src/config/content-store.js';

const CONTENT_BUS_ID = SITE_CONFIG.content.contentBusId;

describe('Content Store Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('constructor uses arguments', async () => {
    const cs = new ContentStore('query', 'foo-id');
    assert.strictEqual(cs.contentBusId, 'foo-id');
    assert.strictEqual(cs.type, 'query');
  });

  describe('query config', () => {
    const INDEX = `
    version: 1

    indices:
      default:
        target: /query-index
        properties:
          lastModified:
            select: none
            value: |
              parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')
    `;

    function setupTest(data) {
      const suffix = '/org/sites/site/config/content/query.yaml';
      return {
        context: createContext(suffix, {
          data,
          env: {
            HELIX_STORAGE_DISABLE_R2: 'true',
          },
        }),
        info: createInfo(suffix),
      };
    }

    /** @type {ContentStore} */
    let cs;

    beforeEach(() => {
      cs = new ContentStore('query', CONTENT_BUS_ID);
    });

    describe('read', () => {
      it('returns data from storage', async () => {
        nock.indexConfig(INDEX);

        const { context } = setupTest();
        const result = await cs.fetchRead(context);

        assert.strictEqual(result.status, 200);
        assert.strictEqual(await result.text(), INDEX);
      });

      it('returns 404', async () => {
        nock.indexConfig(null);

        const { context } = setupTest();
        const result = await cs.fetchRead(context);
        assert.strictEqual(result.status, 404);
      });
    });

    describe('create', () => {
      it('stores new data in storage', async () => {
        nock.content()
          .headObject('/preview/.helix/query.yaml')
          .reply(404)
          .putObject('/preview/.helix/query.yaml')
          .reply(201)
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          });

        const { context, info } = setupTest(INDEX);

        const result = await cs.fetchCreate(context, info);
        assert.strictEqual(result.status, 201);
      });

      it('returns 403 when org/site is not the original repository', async () => {
        nock.content()
          .headObject('/preview/.helix/query.yaml')
          .reply(404);

        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/original-site',
          });

        const { context, info } = setupTest(INDEX);

        const result = await cs.fetchCreate(context, info);
        assert.strictEqual(result.status, 403);
        assert.deepStrictEqual(result.headers.plain(), {
          'cache-control': 'no-store, private, must-revalidate',
          'content-type': 'text/plain; charset=utf-8',
          'x-error': 'Content configuration changes are restricted to the primary site: org/original-site',
        });
      });

      it('returns 409 if config already exists in storage', async () => {
        nock.content()
          .headObject('/preview/.helix/query.yaml')
          .reply(200);

        const { context, info } = setupTest(INDEX);

        const result = await cs.fetchCreate(context, info);
        assert.strictEqual(result.status, 409);
      });

      it('returns 400 when index config passed is invalid', async () => {
        nock.content()
          .headObject('/preview/.helix/query.yaml')
          .reply(404)
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          });

        const { context, info } = setupTest('indices: ');

        const result = await cs.fetchCreate(context, info);
        assert.strictEqual(result.status, 400);
      });

      it('returns error when index config passed has errors', async () => {
        const CONFIG_WITH_ERRORS = `indices:
  default:
    target: /query-index
    properties:
      lastModified:
        select: none
        value: parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')
   other:
    target: /query-index
    properties:
      lastModified:
        select: none
        value: parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')`;

        nock.content()
          .headObject('/preview/.helix/query.yaml')
          .reply(404)
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          });

        const { context, info } = setupTest(CONFIG_WITH_ERRORS);

        const result = await cs.fetchCreate(context, info);
        assert.strictEqual(result.status, 400);
        assert.match(result.headers.get('x-error'), /All mapping items must start at the same column/);
      });

      it('returns 400 when no index config is passed', async () => {
        nock.content()
          .headObject('/preview/.helix/query.yaml')
          .reply(404)
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          });

        const { context, info } = setupTest(null);

        const result = await cs.fetchCreate(context, info);
        assert.strictEqual(result.status, 400);
        assert.deepStrictEqual(result.headers.plain(), {
          'cache-control': 'no-store, private, must-revalidate',
          'content-type': 'text/plain; charset=utf-8',
          'x-error': "No 'query' config in body or bad content type",
          'x-error-code': 'AEM_BACKEND_CONFIG_TYPE_MISSING',
        });
      });
    });

    describe('update', () => {
      it('query config in storage', async () => {
        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          })
          .putObject('/preview/.helix/query.yaml')
          .reply(201);

        const { context, info } = setupTest(INDEX);

        const result = await cs.fetchUpdate(context, info);
        assert.strictEqual(result.status, 204);
      });
    });

    describe('delete', () => {
      it('removes query config from storage', async () => {
        nock.indexConfig(INDEX);
        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          })
          .deleteObject('/preview/.helix/query.yaml')
          .reply(204);

        const { context, info } = setupTest();

        const result = await cs.fetchRemove(context, info);
        assert.strictEqual(result.status, 204);
      });

      it('returns 403 when org/site is not the original repository', async () => {
        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/original-site',
          });

        const { context, info } = setupTest(INDEX);

        const result = await cs.fetchRemove(context, info);
        assert.strictEqual(result.status, 403);
        assert.deepStrictEqual(result.headers.plain(), {
          'cache-control': 'no-store, private, must-revalidate',
          'content-type': 'text/plain; charset=utf-8',
          'x-error': 'Content configuration changes are restricted to the primary site: org/original-site',
        });
      });
    });
  });

  describe('sitemap config', () => {
    const SITEMAP = `
    sitemaps:
      default:
        source: /query-index.json
        destination: /sitemap.xml
    `;

    function setupTest(data) {
      const suffix = '/org/sites/site/config/content/sitemap.yaml';
      return {
        context: createContext(suffix, {
          data,
          env: {
            HELIX_STORAGE_DISABLE_R2: 'true',
          },
        }),
        info: createInfo(suffix),
      };
    }

    /** @type {ContentStore} */
    let cs;

    beforeEach(() => {
      cs = new ContentStore('sitemap', CONTENT_BUS_ID);
    });

    describe('create', () => {
      it('returns 403 when org/site is not the original repository', async () => {
        nock.content()
          .headObject('/preview/.helix/sitemap.yaml')
          .reply(404);

        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-repository': 'org/original-site',
          });

        const { context, info } = setupTest(SITEMAP);

        const result = await cs.fetchCreate(context, info);
        assert.strictEqual(result.status, 403);
        assert.deepStrictEqual(result.headers.plain(), {
          'cache-control': 'no-store, private, must-revalidate',
          'content-type': 'text/plain; charset=utf-8',
          'x-error': 'Content configuration changes are restricted to the primary site: org/original-site',
        });
      });
    });

    describe('update', () => {
      it('sitemap config in storage', async () => {
        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          })
          .putObject('/preview/.helix/sitemap.yaml')
          .reply(201);

        const { context, info } = setupTest(SITEMAP);

        const result = await cs.fetchUpdate(context, info);
        assert.strictEqual(result.status, 204);
      });

      it('returns 403 when org/site is not the original repository', async () => {
        nock.content()
          .getObject('/.hlx.json')
          .reply(404);

        const { context, info } = setupTest(SITEMAP);

        const result = await cs.fetchUpdate(context, info);
        assert.strictEqual(result.status, 403);
      });

      it('returns 400 when sitemap config passed is invalid', async () => {
        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          });

        const { context, info } = setupTest('sitemaps: ');

        const result = await cs.fetchUpdate(context, info);
        assert.strictEqual(result.status, 400);
      });

      it('returns 400 when no sitemap config is passed', async () => {
        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          });

        const { context, info } = setupTest(null);

        const result = await cs.fetchUpdate(context, info);
        assert.strictEqual(result.status, 400);
        assert.deepStrictEqual(result.headers.plain(), {
          'cache-control': 'no-store, private, must-revalidate',
          'content-type': 'text/plain; charset=utf-8',
          'x-error': "No 'sitemap' config in body or bad content type",
          'x-error-code': 'AEM_BACKEND_CONFIG_TYPE_MISSING',
        });
      });

      it('returns error when sitemap config passed has errors', async () => {
        const CONFIG_WITH_ERRORS = `sitemaps:
  default:
    source: /query-index.json
    destination: /sitemap.xml

   other:
    source: /other-index.json
    destination: /other-sitemap.xml`;

        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          });

        const { context, info } = setupTest(CONFIG_WITH_ERRORS);

        const result = await cs.fetchUpdate(context, info);
        assert.strictEqual(result.status, 400);
        assert.match(result.headers.get('x-error'), /All mapping items must start at the same column/);
      });
    });

    describe('delete', () => {
      it('removes sitemap config from storage', async () => {
        nock.sitemapConfig(SITEMAP);
        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          })
          .deleteObject('/preview/.helix/sitemap.yaml')
          .reply(204);

        const { context, info } = setupTest();

        const result = await cs.fetchRemove(context, info);
        assert.strictEqual(result.status, 204);
      });

      it('returns 404 if config not found', async () => {
        nock.sitemapConfig(null);
        nock.content()
          .getObject('/.hlx.json')
          .reply(200, {
            'original-site': 'org/site',
          });

        const { context, info } = setupTest();

        const result = await cs.fetchRemove(context, info);
        assert.strictEqual(result.status, 404);
        assert.deepStrictEqual(result.headers.plain(), {
          'cache-control': 'no-store, private, must-revalidate',
          'content-type': 'text/plain; charset=utf-8',
          'x-error': 'Config not found',
          'x-error-code': 'AEM_BACKEND_CONFIG_MISSING',
        });
      });
    });
  });
});
