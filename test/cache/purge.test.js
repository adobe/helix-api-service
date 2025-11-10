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
import purge, {
  getPurgePathVariants,
  PURGE_LIVE, PURGE_PREVIEW, PURGE_PREVIEW_AND_LIVE,
} from '../../src/cache/purge.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

describe('Purge Variants', () => {
  it('calculates variants correctly for no extension', () => {
    assert.deepStrictEqual(getPurgePathVariants('/foo'), [
      '/foo', '/foo.plain.html',
    ]);
  });

  it('calculates variants correctly for multiple paths', () => {
    assert.deepStrictEqual(getPurgePathVariants(['/query.json', '/foo.xml']), [
      '/query.json', '/foo.xml',
    ]);
  });

  it('calculates variants correctly for index', () => {
    assert.deepStrictEqual(getPurgePathVariants('/en/'), [
      '/en/', '/en/index.plain.html',
    ]);
  });
});

describe('Purge Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  const ENV = {
    HLX_FASTLY_PURGE_TOKEN: '1234',
  };

  describe('(url)', () => {
    function setupTest(path = '/') {
      const suffix = `/org/sites/site/cache${path}`;
      const context = createContext(suffix, { env: ENV });
      const info = createInfo(suffix).withCode('owner', 'repo');
      return { context, info };
    }

    it('purges live url', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'DiyvKbkf2MaZORJJ',
              '8lnjgOWBwsoqAQXB',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'DiyvKbkf2MaZORJJ',
              '8lnjgOWBwsoqAQXB',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });

    it('purges preview and live url', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'DiyvKbkf2MaZORJJ',
              'p_DiyvKbkf2MaZORJJ',
              '8lnjgOWBwsoqAQXB',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'DiyvKbkf2MaZORJJ',
              'p_DiyvKbkf2MaZORJJ',
              '8lnjgOWBwsoqAQXB',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.resource(context, info, PURGE_PREVIEW_AND_LIVE);
      assert.strictEqual(result.status, 200);
    });

    it('purges live url with html extension', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'ti4OdwTK6sZH0Pbn',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'ti4OdwTK6sZH0Pbn',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest('/products/ABC-344.html');
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });

    it('purges page url', async () => {
      nock('https://api.fastly.com')
        .post('/purge/main--site--org.hlx.page/helix-config.json')
        .reply(function f() {
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/purge/main--site--org.hlx-fastly.page/helix-config.json')
        .reply(function f() {
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.hlxPage(context, info, ['/helix-config.json']);
      assert.strictEqual(result.status, 200);
    });

    it('purges page url can fail', async () => {
      nock('https://api.fastly.com')
        .post('/purge/main--site--org.hlx.page/helix-config.json')
        .reply(function f() {
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [404];
        })
        .post('/purge/main--site--org.hlx-fastly.page/helix-config.json')
        .reply(function f() {
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.hlxPage(context, info, ['/helix-config.json']);
      assert.strictEqual(result.status, 404);
    });

    it('purges live url for xml', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'sby9rtkIBtNieA0T',
              'PjItaMe-aiYUBcYB',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'sby9rtkIBtNieA0T',
              'PjItaMe-aiYUBcYB',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest('/sitemap.xml');
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });

    it('handles error from purge', async () => {
      nock('https://api.fastly.com')
        .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
        .reply(500, 'guru!')
        .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
        .reply(500, 'guru!');

      const { context, info } = setupTest();
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 502);
    });

    it('purges redirect paths', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              's9Ws5y-QiKnatGn1',
              '5elsUSGxLK7160mA',
              'w6eiqRHzt4pOEey5',
              '0l_ve8MRySIx4HxF',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              's9Ws5y-QiKnatGn1',
              '5elsUSGxLK7160mA',
              'w6eiqRHzt4pOEey5',
              '0l_ve8MRySIx4HxF',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.redirects(context, info, [
        '/home.md',
        '/foo.html',
        '/blog/index.md',
        '/just_in_case',
      ], PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });
  });

  describe('(surrogate)', () => {
    function setupTest(path = '/en/query-index.json', { env = ENV, metadata = {} } = {}) {
      const suffix = `/org/sites/site/cache${path}`;
      const context = createContext(suffix, {
        env,
        attributes: {
          config: {
            ...SITE_CONFIG,
            metadata,
          },
        },
      });
      const info = createInfo(suffix).withCode('owner', 'repo');
      return { context, info };
    }

    it('surrogate purge needs token', async () => {
      const { context, info } = setupTest('/head', { env: {} });
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 500);
      assert.deepStrictEqual(result.headers.plain(), {
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'purge token missing.',
      });
    });

    it('purges json', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'lAKEj4mgHHLiyxX6',
              'fhy7zxoNym_6JoRo',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'lAKEj4mgHHLiyxX6',
              'fhy7zxoNym_6JoRo',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });

    it('purges json (preview)', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'p_lAKEj4mgHHLiyxX6',
              'fhy7zxoNym_6JoRo',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest('/en/query-index.json');
      const result = await purge.resource(context, info, PURGE_PREVIEW);
      assert.strictEqual(result.status, 200);
    });

    it('does not send more than 256 in one post', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .twice()
        .reply((uri, body) => {
          assert.strictEqual(body.surrogate_keys.length, 256);
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .twice()
        .reply((uri, body) => {
          assert.strictEqual(body.surrogate_keys.length, 256);
          return [200];
        });

      const keys = new Array(512);
      for (let i = 0; i < keys.length; i += 1) {
        keys[i] = `key${i}`;
      }

      const { context, info } = setupTest();
      const result = await purge.surrogate(context, info, keys, PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });

    it('handles error', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(500)
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(200);

      const { context, info } = setupTest();
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 502);
    });

    it('purges head.html', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'main--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'main--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest('/head');
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });

    it('purges metadata.json', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'U_NW4adJU7Qazf-I',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              `${SITE_CONFIG.content.contentBusId}_metadata`,
              '0BbXqRmqgStJ7irR',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'U_NW4adJU7Qazf-I',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              `${SITE_CONFIG.content.contentBusId}_metadata`,
              '0BbXqRmqgStJ7irR',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'U_NW4adJU7Qazf-I',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest('/metadata.json');
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });

    it('purges also metadata-*.json (helix 5)', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'U_NW4adJU7Qazf-I',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              `${SITE_CONFIG.content.contentBusId}_metadata`,
              '8DD0pNaE1hdJrCU3',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'U_NW4adJU7Qazf-I',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              `${SITE_CONFIG.content.contentBusId}_metadata`,
              '8DD0pNaE1hdJrCU3',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'U_NW4adJU7Qazf-I',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest('/metadata-authors.json', {
        metadata: {
          source: '/metadata-authors.json',
        },
      });
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });

    it('purges folder mapped metadata.json', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'MsueC3kn41CeYvWZ_metadata',
              'zPyegZLNQrXm7f6_',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'MsueC3kn41CeYvWZ_metadata',
              'zPyegZLNQrXm7f6_',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest('/products/metadata.json');
      const result = await purge.resource(context, info, PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });
  });

  describe('(code)', () => {
    function toCDNConfig(sheet) {
      const config = {};
      sheet.data.forEach(({ key, value }) => {
        const segs = key.split('.');
        const child = segs.slice(0, -1).reduce((parent, seg) => {
          if (!parent[seg]) {
            // eslint-disable-next-line no-param-reassign
            parent[seg] = Object.create(null);
          }
          return parent[seg];
        }, config);
        child[segs.at(-1)] = value;
      });
      return config.cdn;
    }

    const CONFIG_FASTLY = (serviceId = '123456abc') => toCDNConfig({
      data: [{
        key: 'cdn.prod.host',
        value: 'demo.helix3.page',
      },
      {
        key: 'cdn.prod.type',
        value: 'fastly',
      },
      {
        key: 'cdn.prod.serviceId',
        value: serviceId,
      },
      {
        key: 'cdn.prod.authToken',
        value: 'abcdefgh',
      }],
    });

    function setupTest(cdn = CONFIG_FASTLY()) {
      const suffix = '/org/sites/site/code/main/';
      const context = createContext(suffix, {
        env: ENV,
        attributes: {
          config: {
            ...SITE_CONFIG,
            cdn,
          },
        },
      });
      const info = createInfo(suffix)
        .withCode('owner', 'repo').withRef('main');
      return { context, info };
    }

    it('purges resources and head', async () => {
      nock.inventory([]);
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'APp_02UP-uX20z4B',
              'B6aQUMMo1SOKwKDk',
              'main--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'APp_02UP-uX20z4B',
              'B6aQUMMo1SOKwKDk',
              'main--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/123456abc/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'APp_02UP-uX20z4B',
              'B6aQUMMo1SOKwKDk',
              'main--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
          return [200];
        });
      const { context, info } = setupTest();
      const result = await purge.code(context, info, [
        '/styles.js',
        '/head.html',
      ]);
      assert.strictEqual(result.status, 200);
    });

    it('purges resources and head (helix 5)', async () => {
      nock.inventory([{
        org: 'org', site: 'site', codeBusId: 'owner/repo', cdnId: 'fastly:1234',
      }, {
        org: 'org', site: 'other', codeBusId: 'owner/repo', cdnId: 'fastly:5678',
      }]);
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'APp_02UP-uX20z4B',
              'B6aQUMMo1SOKwKDk',
              'main--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'APp_02UP-uX20z4B',
              'B6aQUMMo1SOKwKDk',
              'main--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/1234/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'APp_02UP-uX20z4B',
              'B6aQUMMo1SOKwKDk',
              'main--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
          return [200];
        })
        .post('/service/5678/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'APp_02UP-uX20z4B',
              'B6aQUMMo1SOKwKDk',
              'main--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
          return [200];
        });

      nock.siteConfig({
        ...SITE_CONFIG,
        cdn: CONFIG_FASTLY('5678'),
      }, { site: 'other' });

      const { context, info } = setupTest(CONFIG_FASTLY('1234'));
      const result = await purge.code(context, info, [
        '/styles.js',
        '/head.html',
      ]);
      assert.strictEqual(result.status, 200);
    });

    it('purges all code if more than 10 paths', async () => {
      nock.inventory([]);
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'main--repo--owner_code',
              'main--repo--owner_head',
              'main--repo--owner_404',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'main--repo--owner_code',
              'main--repo--owner_head',
              'main--repo--owner_404',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/123456abc/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'main--repo--owner_code',
              'main--repo--owner_head',
              'main--repo--owner_404',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.code(context, info, [
        '/fstab.yaml',
        '/head.html',
        '/code1.js',
        '/code2.js',
        '/code3.js',
        '/code4.js',
        '/code5.js',
        '/code6.js',
        '/code7.js',
        '/code8.js',
        '/code9.js',
        '/code10.js',
      ]);
      assert.strictEqual(result.status, 200);
    });

    it('purges 404 and head for fstab.yaml', async () => {
      nock.inventory([]);
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'rIZtZQmdBVsFiL76',
              'main--repo--owner_head',
              'main--repo--owner_404',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'rIZtZQmdBVsFiL76',
              'main--repo--owner_head',
              'main--repo--owner_404',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/123456abc/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'rIZtZQmdBVsFiL76',
              'main--repo--owner_head',
              'main--repo--owner_404',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.code(context, info, [
        '/fstab.yaml',
      ]);
      assert.strictEqual(result.status, 200);
    });

    it('purges json', async () => {
      nock.inventory([]);
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              '_pmFJSnfG-oXpmb6',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              '_pmFJSnfG-oXpmb6',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/123456abc/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              '_pmFJSnfG-oXpmb6',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.code(context, info, [
        '/test.json',
      ]);
      assert.strictEqual(result.status, 200);
    });

    it('purges sitemap', async () => {
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'sby9rtkIBtNieA0T',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'sby9rtkIBtNieA0T',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/123456abc/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'sby9rtkIBtNieA0T',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.content(context, info, [
        '/sitemap.xml',
      ], PURGE_LIVE);
      assert.strictEqual(result.status, 200);
    });

    it('does not purge BYO on non-main branch', async () => {
      nock.inventory([]);
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'wj_bTKTmN15y7Ytr',
              'efbFuvT8UH_4lweb',
              'ref--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        })
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'wj_bTKTmN15y7Ytr',
              'efbFuvT8UH_4lweb',
              'ref--repo--owner_head',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });
      const { context, info } = setupTest();
      const result = await purge.code(context, info.withRef('ref'), [
        '/styles.js',
        '/head.html',
      ]);
      assert.strictEqual(result.status, 200);
    });

    it('does not purge BYO on scope that does not include live', async () => {
      nock('https://api.fastly.com')
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(function f(uri, body) {
          assert.deepStrictEqual(body, {
            surrogate_keys: [
              'p_sby9rtkIBtNieA0T',
            ],
          });
          assert.strictEqual(this.req.headers['fastly-key'], '1234');
          return [200];
        });

      const { context, info } = setupTest();
      const result = await purge.content(context, info, [
        '/sitemap.xml',
      ], PURGE_PREVIEW);
      assert.strictEqual(result.status, 200);
    });

    it('handles error from surrogate purge', async () => {
      nock.inventory([]);
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(500)
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(200)
        .post('/service/123456abc/purge')
        .reply(200);

      const { context, info } = setupTest();
      const result = await purge.code(context, info, [
        '/styles.js',
        '/head.html',
      ]);
      assert.strictEqual(result.status, 502);
    });

    it('handles error from url purge', async () => {
      nock.inventory([]);
      nock('https://api.fastly.com')
        .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
        .reply(200)
        .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
        .reply(500)
        .post('/service/123456abc/purge')
        .reply(200);

      const { context, info } = setupTest();
      const result = await purge.code(context, info, [
        '/styles.js',
        '/head.html',
      ]);
      assert.strictEqual(result.status, 502);
    });

    it('handles error from url purge (coverage)', async () => {
      nock('https://api.fastly.com')
        .post('/purge/main--repo--owner.hlx.live/styles.js')
        .reply(500)
        .post(/^\/purge\/main--(site--org|repo--owner).(?:aem|hlx)(?:-fastly)?\.(?:live|page)\/styles\.js$/)
        .times(3)
        .reply(200);
      nock('https://demo.helix3.page')
        .intercept('/styles.js', 'PURGE')
        .reply(200);
      const { context, info } = setupTest();
      const result = await purge.perform(context, info, [{ path: '/styles.js' }], PURGE_LIVE);
      assert.strictEqual(result.status, 502);
    });
  });
});
