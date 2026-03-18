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

    it('read returns data from storage', async () => {
      nock.indexConfig(INDEX);

      const cs = new ContentStore('query', CONTENT_BUS_ID);
      const { context } = setupTest();
      const result = await cs.fetchRead(context);

      assert.strictEqual(result.status, 200);
      assert.strictEqual(await result.text(), INDEX);
    });

    it('read returns 404', async () => {
      nock.indexConfig(null);

      const cs = new ContentStore('query', CONTENT_BUS_ID);
      const { context } = setupTest();
      const result = await cs.fetchRead(context);
      assert.strictEqual(result.status, 404);
    });

    it('create stores new data in storage', async () => {
      nock.content()
        .headObject('/preview/.helix/query.yaml')
        .reply(404)
        .putObject('/preview/.helix/query.yaml')
        .reply(201);

      nock.content()
        .getObject('/.hlx.json')
        .reply(200, {
          'original-site': 'org/site',
        });

      const cs = new ContentStore('query', CONTENT_BUS_ID);
      const { context, info } = setupTest(INDEX);

      const result = await cs.fetchCreate(context, info);
      assert.strictEqual(result.status, 201);
    });

    it('create returns 403 when org/site is not the original repository', async () => {
      nock.content()
        .headObject('/preview/.helix/query.yaml')
        .reply(404);

      nock.content()
        .getObject('/.hlx.json')
        .reply(200, {
          'original-site': 'org/original-site',
        });

      const cs = new ContentStore('query', CONTENT_BUS_ID);
      const { context, info } = setupTest(INDEX);

      const result = await cs.fetchCreate(context, info);
      assert.strictEqual(result.status, 403);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'Content configuration changes are restricted to the primary site: org/original-site',
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

    it('create returns 403 when org/site is not the original repository', async () => {
      nock.content()
        .headObject('/preview/.helix/sitemap.yaml')
        .reply(404);

      nock.content()
        .getObject('/.hlx.json')
        .reply(200, {
          'original-repository': 'org/original-site',
        });

      const cs = new ContentStore('sitemap', CONTENT_BUS_ID);
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
});

//   it('create returns 403 when org/site is not the original site or repository', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .head('/foo-id/preview/.helix/query.yaml')
//       .reply(404)
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//       });

//     const cs = new ContentStore('query', 'foo-id');
//     const result = await cs.fetchCreate(DEFAULT_CONTEXT(), DEFAULT_INFO());
//     assert.strictEqual(result.status, 403);
//     assert.deepStrictEqual(result.headers.plain(), {
//       'cache-control': 'no-store, private, must-revalidate',
//       'content-type': 'text/plain; charset=utf-8',
//       'x-error': 'Content configuration changes are restricted to the primary site: n/a',
//     });
//   });

//   it('create returns 409 if already exists new data in storage', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .head('/foo-id/preview/.helix/query.yaml')
//       .reply(200);

//     const cs = new ContentStore('query', 'foo-id');
//     const result = await cs.fetchCreate(DEFAULT_CONTEXT());
//     assert.strictEqual(result.status, 409);
//   });

//   it('create returns 400 when index config passed is invalid', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .head('/foo-id/preview/.helix/query.yaml')
//       .reply(404)
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'owner/repo',
//       });

//     const cs = new ContentStore('query', 'foo-id');
//     const result = await cs.fetchCreate(DEFAULT_CONTEXT({
//       data: 'indices: ',
//     }), DEFAULT_INFO());
//     assert.strictEqual(result.status, 400);
//   });

//   it('create returns error when index config passed has errors', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .head('/foo-id/preview/.helix/query.yaml')
//       .reply(404)
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'owner/repo',
//       });

//     const cs = new ContentStore('query', 'foo-id');
//     const resp = await cs.fetchCreate(DEFAULT_CONTEXT({
//       data: `indices:
//   default:
//     target: /query-index
//     properties:
//       lastModified:
//         select: none
//         value: parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')
//    other:
//     target: /query-index
//     properties:
//       lastModified:
//         select: none
//         value: parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')
// `,
//     }), DEFAULT_INFO());

//     assert.strictEqual(resp.status, 400);
//     assert.match(resp.headers.get('x-error'), /All mapping items must start at the same column/);
//   });

//   it('create returns 400 when no index config is passed', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .head('/foo-id/preview/.helix/query.yaml')
//       .reply(404)
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'owner/repo',
//       });

//     const cs = new ContentStore('query', 'foo-id');
//     const result = await cs.fetchCreate(DEFAULT_CONTEXT({
//       data: {},
//     }), DEFAULT_INFO());
//     assert.strictEqual(result.status, 400);
//     assert.deepStrictEqual(result.headers.plain(), {
//       'cache-control': 'no-store, private, must-revalidate',
//       'content-type': 'text/plain; charset=utf-8',
//       'x-error': "No 'query' config in body or bad content type",
//       'x-error-code': 'AEM_BACKEND_CONFIG_TYPE_MISSING',
//     });
//   });

//   it('updates query config in storage', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'owner/repo',
//       })
//       .put('/foo-id/preview/.helix/query.yaml?x-id=PutObject')
//       .reply(201);
//     nock('https://helix-content-bus.fake-account-id.r2.cloudflarestorage.com')
//       .put('/foo-id/preview/.helix/query.yaml?x-id=PutObject')
//       .reply(201);

//     const cs = new ContentStore('query', 'foo-id');
//     const result = await cs.fetchUpdate(DEFAULT_CONTEXT({
//       data: INDEX,
//     }), DEFAULT_INFO());
//     assert.strictEqual(result.status, 204);
//   });

//   it('updates sitemap config in storage', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'owner/repo',
//       })
//       .put('/foo-id/preview/.helix/sitemap.yaml?x-id=PutObject')
//       .reply(201);
//     nock('https://helix-content-bus.fake-account-id.r2.cloudflarestorage.com')
//       .put('/foo-id/preview/.helix/sitemap.yaml?x-id=PutObject')
//       .reply(201);

//     const cs = new ContentStore('sitemap', 'foo-id');
//     const result = await cs.fetchUpdate(DEFAULT_CONTEXT({
//       data: SITEMAP,
//     }), DEFAULT_INFO());
//     assert.strictEqual(result.status, 204);
//   });

//   it('update returns 403 when org/site is not the original repository', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'something/else',
//       });

//     const cs = new ContentStore('sitemap', 'foo-id');
//     const result = await cs.fetchUpdate(DEFAULT_CONTEXT({
//       data: SITEMAP,
//     }), DEFAULT_INFO());
//     assert.strictEqual(result.status, 403);
//   });

//   it('update returns error when sitemap config passed is invalid', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'owner/repo',
//       });

//     const cs = new ContentStore('sitemap', 'foo-id');
//     const result = await cs.fetchUpdate(DEFAULT_CONTEXT({
//       data: 'sitemaps: ',
//     }), DEFAULT_INFO());
//     assert.strictEqual(result.status, 400);
//   });

//   it('update returns error when sitemap config passed has errors', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'owner/repo',
//       });

//     const cs = new ContentStore('sitemap', 'foo-id');
//     const resp = await cs.fetchUpdate(DEFAULT_CONTEXT({
//       data: `sitemaps:
//   default:
//     source: /query-index.json
//     destination: /sitemap.xml
//     source: /query-index.json
// `,
//     }), DEFAULT_INFO());
//     assert.strictEqual(resp.status, 400);
//     assert.match(resp.headers.get('x-error'), /Map keys must be unique/);
//   });

//   it('update returns error when no sitemap config is passed', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'owner/repo',
//       });

//     const cs = new ContentStore('sitemap', 'foo-id');
//     const result = await cs.fetchUpdate(DEFAULT_CONTEXT({
//       data: {},
//     }), DEFAULT_INFO());
//     assert.strictEqual(result.status, 400);
//     assert.deepStrictEqual(result.headers.plain(), {
//       'cache-control': 'no-store, private, must-revalidate',
//       'content-type': 'text/plain; charset=utf-8',
//       'x-error': "No 'sitemap' config in body or bad content type",
//       'x-error-code': 'AEM_BACKEND_CONFIG_TYPE_MISSING',
//     });
//   });

//   it('removes query config from storage', async () => {
//     nock.index(INDEX);

//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'owner/repo',
//       })
//       .delete('/foo-id/preview/.helix/query.yaml?x-id=DeleteObject')
//       .reply(204);
//     nock('https://helix-content-bus.fake-account-id.r2.cloudflarestorage.com')
//       .delete('/foo-id/preview/.helix/query.yaml?x-id=DeleteObject')
//       .reply(204);

//     const cs = new ContentStore('query', 'foo-id');
//     const result = await cs.fetchRemove(DEFAULT_CONTEXT(), DEFAULT_INFO());
//     assert.strictEqual(result.status, 204);
//   });

//   it('remove returns 403 when org/site is not the original repository', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'something/else',
//       });

//     const cs = new ContentStore('query', 'foo-id');
//     const result = await cs.fetchRemove(DEFAULT_CONTEXT(), DEFAULT_INFO());
//     assert.strictEqual(result.status, 403);
//   });

//   it('removes sends 404 if config not found', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .get('/foo-id/.hlx.json?x-id=GetObject')
//       .reply(200, {
//         'original-site': 'owner/repo',
//       })
//       .get('/foo-id/preview/.helix/query.yaml?x-id=GetObject')
//       .reply(404, notFound);

//     const cs = new ContentStore('query', 'foo-id');
//     const result = await cs.fetchRemove(DEFAULT_CONTEXT(), DEFAULT_INFO());
//     assert.strictEqual(result.status, 404);
//     assert.deepStrictEqual(result.headers.plain(), {
//       'cache-control': 'no-store, private, must-revalidate',
//       'content-type': 'text/plain; charset=utf-8',
//       'x-error': 'Config not found',
//       'x-error-code': 'AEM_BACKEND_CONFIG_MISSING',
//     });
//   });
