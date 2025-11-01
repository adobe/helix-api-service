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
import { createContext, createInfo, Nock } from '../utils.js';

import purge, {
  PURGE_LIVE,
  getPurgePathVariants,
  PURGE_PREVIEW_AND_LIVE,
} from '../../src/cache/purge.js';

// const SITE_CONFIG = (serviceId) => ({
//   version: 1,
//   title: 'Sample site',
//   content: {
//     name: 'sample-site',
//     contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
//     source: {
//       type: 'google',
//       url: 'https://drive.google.com/drive/u/0/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
//       id: '18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
//     },
//   },
//   code: {
//     owner: 'owner',
//     repo: 'repo',
//     source: {
//       type: 'github',
//       url: 'https://github.com/owner/repo',
//     },
//   },
//   headers: {
//     '/tools/sidekick/**:': [{
//       key: 'access-control-allow-origin',
//       value: '/.*/',
//     }],
//   },
//   cdn: {
//     prod: {
//       type: 'fastly',
//       serviceId,
//       host: 'demo.helix3.page',
//       authToken: 'abcdefgh',
//     },
//   },
// });

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

describe('Purge Tests (url)', () => {
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

  it('purges live url', async () => {
    const suffix = '/org/sites/site/cache/';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'DiyvKbkf2MaZORJJ',
            'fVmOUzFkRxTl6DpU',
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
            'fVmOUzFkRxTl6DpU',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });

    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('purges preview and live url', async () => {
    const suffix = '/org/sites/site/cache/';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'DiyvKbkf2MaZORJJ',
            'p_DiyvKbkf2MaZORJJ',
            'fVmOUzFkRxTl6DpU',
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
            'fVmOUzFkRxTl6DpU',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });

    const result = await purge.resource(context, info, PURGE_PREVIEW_AND_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('purges live url with html extension', async () => {
    const suffix = '/org/sites/site/cache/products/ABC-344.html';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

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

    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.status, 200);
  });

  it('purges page url', async () => {
    const suffix = '/org/sites/site/cache/';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

    nock('https://api.fastly.com')
      .post('/purge/ref--site--org.hlx.page/helix-config.json')
      .reply(function f() {
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/purge/ref--site--org.hlx-fastly.page/helix-config.json')
      .reply(function f() {
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });

    const result = await purge.hlxPage(context, info, ['/helix-config.json']);
    assert.strictEqual(result.status, 200);
  });

  it('purges page url can fail', async () => {
    const suffix = '/org/sites/site/cache/';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

    nock('https://api.fastly.com')
      .post('/purge/ref--site--org.hlx.page/helix-config.json')
      .reply(function f() {
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [404];
      })
      .post('/purge/ref--site--org.hlx-fastly.page/helix-config.json')
      .reply(function f() {
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });

    const result = await purge.hlxPage(context, info, ['/helix-config.json']);
    assert.strictEqual(result.status, 404);
  });

  it('purges live url for xml', async () => {
    const suffix = '/org/sites/site/cache/sitemap.xml';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'sby9rtkIBtNieA0T',
            'cIbyd1sFZueO-g_Q',
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
            'cIbyd1sFZueO-g_Q',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });

    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from purge', async () => {
    const suffix = '/org/sites/site/cache/';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(500, 'guru!')
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(500, 'guru!');

    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges redirect paths', async () => {
    const suffix = '/org/sites/site/cache/';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

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

    const result = await purge.redirects(context, info, [
      '/home.md',
      '/foo.html',
      '/blog/index.md',
      '/just_in_case',
    ], PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });
});

// describe('Purge Tests (surrogate)', () => {
//   const DEFAULT_INFO = createPathInfo('/cache/owner/repo/ref/en/query-index.json', 'POST');

//   let nock;
//   beforeEach(() => {
//     nock = new Nock().env();
//   });

//   afterEach(() => {
//     nock.done();
//   });

//   it('surrogate purge needs token', async () => {
//     nock.configAll('foo-id');
//     const result = await purge({
//       ...TEST_CONTEXT(),
//       env: {
//         AWS_REGION: 'us-east-1',
//         AWS_ACCESS_KEY_ID: 'fake-key-id',
//         AWS_SECRET_ACCESS_KEY: 'fake-secret',
//       },
//     }, {
//       ...DEFAULT_INFO,
//       path: '/head',
//       resourcePath: '/head.html',
//     }, PURGE_LIVE);
//     assert.strictEqual(result.status, 500);
//     assert.deepStrictEqual(result.headers.plain(), {
//       'content-type': 'text/plain; charset=utf-8',
//       'x-error': 'purge token missing.',
//     });
//   });

//   it('purges json', async () => {
//     nock.configAll('foo-id');
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'WPLbm__g0LmmeETG',
//             'T30u3hbr93UdggV6',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'WPLbm__g0LmmeETG',
//             'T30u3hbr93UdggV6',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       });

//     const result = await purge(TEST_CONTEXT(), DEFAULT_INFO, PURGE_LIVE);
//     assert.strictEqual(result.status, 200);
//   });

//   it('purges json (preview)', async () => {
//     nock.configAll('foo-id');
//     nock('https://api.fastly.com')
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'p_WPLbm__g0LmmeETG',
//             'T30u3hbr93UdggV6',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       });

//     const result = await purge(TEST_CONTEXT(), DEFAULT_INFO, PURGE_PREVIEW);
//     assert.strictEqual(result.status, 200);
//   });

//   it('does not send more than 256 in one post', async () => {
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .twice()
//       .reply((uri, body) => {
//         assert.strictEqual(body.surrogate_keys.length, 256);
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .twice()
//       .reply((uri, body) => {
//         assert.strictEqual(body.surrogate_keys.length, 256);
//         return [200];
//       });

//     const keys = new Array(512);
//     for (let i = 0; i < keys.length; i += 1) {
//       keys[i] = `key${i}`;
//     }
//     const result = await surrogatePurge(TEST_CONTEXT(), DEFAULT_INFO, keys, PURGE_LIVE);
//     assert.strictEqual(result.status, 200);
//   });

//   it('handles error', async () => {
//     nock.configAll('foo-id');
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(500)
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(200);

//     const result = await purge(TEST_CONTEXT(), DEFAULT_INFO, PURGE_LIVE);
//     assert.strictEqual(result.status, 502);
//   });

//   it('purges head.html', async () => {
//     nock.configAll('foo-id');
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'ref--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'ref--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       });

//     const result = await purge(TEST_CONTEXT(), {
//       ...DEFAULT_INFO,
//       path: '/head',
//       resourcePath: '/head.html',
//     }, PURGE_LIVE);
//     assert.strictEqual(result.status, 200);
//   });

//   it('purges metadata.json', async () => {
//     nock.configAll('foo-id');
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'u9DQngmJ6BZT5Mdb',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'foo-id_metadata',
//             'IqlcrkmQ7UF_oYQp',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'u9DQngmJ6BZT5Mdb',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'foo-id_metadata',
//             'IqlcrkmQ7UF_oYQp',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'u9DQngmJ6BZT5Mdb',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       });

//     const result = await purge(TEST_CONTEXT(), {
//       ...DEFAULT_INFO,
//       path: '/metadata.json',
//       resourcePath: '/metadata.json',
//     }, PURGE_LIVE);
//     assert.strictEqual(result.status, 200);
//   });

//   it('purges also metadata-*.json', async () => {
//     nock.configAll('foo-id', {
//       config: {
//         data: {
//           metadata: '/metadata-authors.json',
//         },
//       },
//     });
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'u9DQngmJ6BZT5Mdb',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'foo-id_metadata',
//             'owEDsqz__89pkQWg',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'u9DQngmJ6BZT5Mdb',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'foo-id_metadata',
//             'owEDsqz__89pkQWg',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'u9DQngmJ6BZT5Mdb',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       });

//     const result = await purge(TEST_CONTEXT(), {
//       ...DEFAULT_INFO,
//       path: '/metadata-authors.json',
//       resourcePath: '/metadata-authors.json',
//     }, PURGE_LIVE);
//     assert.strictEqual(result.status, 200);
//   });

//   it('purges also metadata-*.json (helix 5)', async () => {
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'u9DQngmJ6BZT5Mdb',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f_metadata',
//             '8DD0pNaE1hdJrCU3',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'u9DQngmJ6BZT5Mdb',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f_metadata',
//             '8DD0pNaE1hdJrCU3',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'u9DQngmJ6BZT5Mdb',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       });

//     const context = DEFAULT_CONTEXT({
//       env: { HLX_FASTLY_PURGE_TOKEN: '1234' },
//     });
//     const info = DEFAULT_INFO;
//     const cfg = SITE_CONFIG('1234');
//     cfg.metadata = {
//       source: [
//         '/metadata-authors.json',
//       ],
//     };
//     await applyConfig(context, info, cfg);
//     const result = await purge(context, {
//       ...DEFAULT_INFO,
//       path: '/metadata-authors.json',
//       resourcePath: '/metadata-authors.json',
//     }, PURGE_LIVE);
//     assert.strictEqual(result.status, 200);
//   });

//   it('purges folder mapped metadata.json', async () => {
//     nock.configAll('foo-id');
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'DkWRSLagCuHkTKOG_metadata',
//             'qG6rNEoZ9yzRNqqC',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'DkWRSLagCuHkTKOG_metadata',
//             'qG6rNEoZ9yzRNqqC',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       });

//     const result = await purge(TEST_CONTEXT(), {
//       ...DEFAULT_INFO,
//       path: '/products/metadata.json',
//       resourcePath: '/products/metadata.json',
//     }, PURGE_LIVE);
//     assert.strictEqual(result.status, 200);
//   });

//   describe('metadata surrogate purges on .helix resources', () => {
//     let contextOverride;
//     beforeEach(() => {
//       contextOverride = {
//         env: {
//           HLX_FASTLY_PURGE_TOKEN: '1234',
//         },
//         attributes: {
//           contentBusId: 'foo-id',
//           configAll: {
//             headers: {
//               data: {
//                 '/**': [
//                   {
//                     key: 'access-control-allow-origin',
//                     value: 'https://example.com',
//                   },
//                   {
//                     key: 'access-control-allow-method',
//                     value: 'GET',
//                   },
//                 ],
//               },
//             },
//           },
//           originalConfigAll: {
//             headers: {
//               data: {
//                 '/**': [
//                   {
//                     key: 'access-control-allow-origin',
//                     value: 'https://example.com',
//                   },
//                 ],
//               },
//             },
//           },
//         },
//       };
//     });

//     it('purges config service and contentbusid on header.json change', async () => {
//       nock('https://api.fastly.com')
//         .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
//         .reply(function f(uri, body) {
//           assert.deepStrictEqual(body, {
//             surrogate_keys: [
//               'u9DQngmJ6BZT5Mdb',
//             ],
//           });
//           assert.strictEqual(this.req.headers['fastly-key'], '1234');
//           return [200];
//         })
//         .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//         .reply(function f(uri, body) {
//           assert.deepStrictEqual(body, {
//             surrogate_keys: [
//               'foo-id',
//               'p_foo-id',
//               'u9DQngmJ6BZT5Mdb',
//             ],
//           });
//           assert.strictEqual(this.req.headers['fastly-key'], '1234');
//           return [200];
//         })
//         .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//         .reply(function f(uri, body) {
//           assert.deepStrictEqual(body, {
//             surrogate_keys: [
//               'foo-id',
//               'p_foo-id',
//               'u9DQngmJ6BZT5Mdb',
//             ],
//           });
//           assert.strictEqual(this.req.headers['fastly-key'], '1234');
//           return [200];
//         });

//       const result = await purge(DEFAULT_CONTEXT(contextOverride), {
//         ...DEFAULT_INFO,
//         path: '/.helix/headers.json',
//         resourcePath: '/.helix/headers.json',
//       }, PURGE_PREVIEW);
//       assert.strictEqual(result.status, 200);
//     });

//     it('purges contentbusid and config service on config.json change', async () => {
//       nock('https://api.fastly.com')
//         .post('/service/SIDuP3HxleUgBDR3Gi8T24/purge')
//         .reply(function f(uri, body) {
//           assert.deepStrictEqual(body, {
//             surrogate_keys: [
//               'u9DQngmJ6BZT5Mdb',
//             ],
//           });
//           assert.strictEqual(this.req.headers['fastly-key'], '1234');
//           return [200];
//         })
//         .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//         .reply(function f(uri, body) {
//           assert.deepStrictEqual(body, {
//             surrogate_keys: [
//               'foo-id',
//               'p_foo-id',
//               'u9DQngmJ6BZT5Mdb',
//             ],
//           });
//           assert.strictEqual(this.req.headers['fastly-key'], '1234');
//           return [200];
//         })
//         .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//         .reply(function f(uri, body) {
//           assert.deepStrictEqual(body, {
//             surrogate_keys: [
//               'foo-id',
//               'p_foo-id',
//               'u9DQngmJ6BZT5Mdb',
//             ],
//           });
//           assert.strictEqual(this.req.headers['fastly-key'], '1234');
//           return [200];
//         });

//       const result = await purge(DEFAULT_CONTEXT(contextOverride), {
//         ...DEFAULT_INFO,
//         path: '/.helix/config.json',
//         resourcePath: '/.helix/config.json',
//       }, PURGE_PREVIEW);
//       assert.strictEqual(result.status, 200);
//     });
//   });
// });

// describe('Purge Tests (code)', () => {
//   const DEFAULT_INFO = createPathInfo('/code/owner/repo/main', 'POST');
//   const CONFIG_FASTLY = {
//     data: [{
//       key: 'cdn.prod.host',
//       value: 'demo.helix3.page',
//     },
//     {
//       key: 'cdn.prod.type',
//       value: 'fastly',
//     },
//     {
//       key: 'cdn.prod.serviceId',
//       value: '123456abc',
//     },
//     {
//       key: 'cdn.prod.authToken',
//       value: 'abcdefgh',
//     }],
//   };

//   let nock;
//   beforeEach(() => {
//     nock = new Nock().env();
//   });

//   afterEach(() => {
//     nock.done();
//   });

//   it('purges resources and head', async () => {
//     nock.projectConfig('foo-id', CONFIG_FASTLY);
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'APp_02UP-uX20z4B',
//             'B6aQUMMo1SOKwKDk',
//             'main--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'APp_02UP-uX20z4B',
//             'B6aQUMMo1SOKwKDk',
//             'main--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/123456abc/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'APp_02UP-uX20z4B',
//             'B6aQUMMo1SOKwKDk',
//             'main--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
//         return [200];
//       });
//     const result = await purgeCode(TEST_CONTEXT(), DEFAULT_INFO, [
//       '/styles.js',
//       '/head.html',
//     ]);
//     assert.strictEqual(result.status, 200);
//   });

//   it('purges resources and head (helix 5)', async () => {
//     nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
//       .get('/default/inventory-v2.json?x-id=GetObject')
//       .reply(200, [{
//         org: 'owner',
//         site: 'repo',
//         codeBusId: 'owner/repo',
//         cdnId: 'fastly:1234',
//       }, {
//         org: 'owner',
//         site: 'other',
//         codeBusId: 'owner/repo',
//         cdnId: 'fastly:5678',
//       }]);
//     nock.config(SITE_CONFIG('5678'), 'owner', 'other', 'main');
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'APp_02UP-uX20z4B',
//             'B6aQUMMo1SOKwKDk',
//             'main--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'APp_02UP-uX20z4B',
//             'B6aQUMMo1SOKwKDk',
//             'main--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/1234/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'APp_02UP-uX20z4B',
//             'B6aQUMMo1SOKwKDk',
//             'main--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
//         return [200];
//       })
//       .post('/service/5678/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'APp_02UP-uX20z4B',
//             'B6aQUMMo1SOKwKDk',
//             'main--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
//         return [200];
//       });
//     const context = DEFAULT_CONTEXT({
//       env: { HLX_FASTLY_PURGE_TOKEN: '1234' },
//     });
//     const info = DEFAULT_INFO;
//     await applyConfig(context, info, SITE_CONFIG('1234'));
//     const result = await purgeCode(context, info, [
//       '/styles.js',
//       '/head.html',
//     ]);
//     assert.strictEqual(result.status, 200);
//   });

//   it('purges all code if more than 10 paths', async () => {
//     nock.projectConfig('foo-id', CONFIG_FASTLY);
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'main--repo--owner_code',
//             'main--repo--owner_head',
//             'main--repo--owner_404',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'main--repo--owner_code',
//             'main--repo--owner_head',
//             'main--repo--owner_404',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/123456abc/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'main--repo--owner_code',
//             'main--repo--owner_head',
//             'main--repo--owner_404',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
//         return [200];
//       });
//     const result = await purgeCode(TEST_CONTEXT(), DEFAULT_INFO, [
//       '/fstab.yaml',
//       '/head.html',
//       '/code1.js',
//       '/code2.js',
//       '/code3.js',
//       '/code4.js',
//       '/code5.js',
//       '/code6.js',
//       '/code7.js',
//       '/code8.js',
//       '/code9.js',
//       '/code10.js',
//     ]);
//     assert.strictEqual(result.status, 200);
//   });

//   it('purges 404 and head for fstab.yaml', async () => {
//     nock.projectConfig('foo-id', CONFIG_FASTLY);
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'rIZtZQmdBVsFiL76',
//             'main--repo--owner_head',
//             'main--repo--owner_404',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'rIZtZQmdBVsFiL76',
//             'main--repo--owner_head',
//             'main--repo--owner_404',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/123456abc/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'rIZtZQmdBVsFiL76',
//             'main--repo--owner_head',
//             'main--repo--owner_404',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
//         return [200];
//       });
//     const result = await purgeCode(TEST_CONTEXT(), DEFAULT_INFO, [
//       '/fstab.yaml',
//     ]);
//     assert.strictEqual(result.status, 200);
//   });

//   it('purges json', async () => {
//     nock.projectConfig('foo-id', CONFIG_FASTLY);
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             '_pmFJSnfG-oXpmb6',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             '_pmFJSnfG-oXpmb6',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/123456abc/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             '_pmFJSnfG-oXpmb6',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
//         return [200];
//       });
//     const result = await purgeCode(TEST_CONTEXT(), DEFAULT_INFO, [
//       '/test.json',
//     ]);
//     assert.strictEqual(result.status, 200);
//   });

//   it('purges sitemap', async () => {
//     nock.projectConfig('foo-id', CONFIG_FASTLY);
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'lkDPpF5moMrrCXQM',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'lkDPpF5moMrrCXQM',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/123456abc/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'lkDPpF5moMrrCXQM',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
//         return [200];
//       });
//     const result = await purgeContent(TEST_CONTEXT(), DEFAULT_INFO, [
//       '/sitemap.xml',
//     ], PURGE_LIVE);
//     assert.strictEqual(result.status, 200);
//   });

//   it('does not purge BYO on non-main branch', async () => {
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'wj_bTKTmN15y7Ytr',
//             'efbFuvT8UH_4lweb',
//             'ref--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       })
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'wj_bTKTmN15y7Ytr',
//             'efbFuvT8UH_4lweb',
//             'ref--repo--owner_head',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       });
//     const result = await purgeCode(TEST_CONTEXT(), {
//       ...DEFAULT_INFO,
//       ref: 'ref',
//     }, [
//       '/styles.js',
//       '/head.html',
//     ]);
//     assert.strictEqual(result.status, 200);
//   });

//   it('does not purge BYO on scope that doesn\'t include live', async () => {
//     nock('https://api.fastly.com')
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(function f(uri, body) {
//         assert.deepStrictEqual(body, {
//           surrogate_keys: [
//             'p_lkDPpF5moMrrCXQM',
//           ],
//         });
//         assert.strictEqual(this.req.headers['fastly-key'], '1234');
//         return [200];
//       });

//     const result = await purgeContent(TEST_CONTEXT(), DEFAULT_INFO, [
//       '/sitemap.xml',
//     ], PURGE_PREVIEW);
//     assert.strictEqual(result.status, 200);
//   });

//   it('handles error from surrogate purge', async () => {
//     nock.projectConfig('foo-id', CONFIG_FASTLY);
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(500)
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(200)
//       .post('/service/123456abc/purge')
//       .reply(200);

//     const result = await purgeCode(TEST_CONTEXT(), DEFAULT_INFO, [
//       '/styles.js',
//       '/head.html',
//     ]);
//     assert.strictEqual(result.status, 502);
//   });

//   it('handles error from url purge', async () => {
//     nock.projectConfig('foo-id', CONFIG_FASTLY);
//     nock('https://api.fastly.com')
//       .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
//       .reply(200)
//       .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
//       .reply(500)
//       .post('/service/123456abc/purge')
//       .reply(200);

//     const result = await purgeCode(TEST_CONTEXT(), DEFAULT_INFO, [
//       '/styles.js',
//       '/head.html',
//     ]);
//     assert.strictEqual(result.status, 502);
//   });

//   it('handles error from url purge (coverage)', async () => {
//     nock.projectConfig('foo-id', CONFIG_FASTLY);
//     nock('https://api.fastly.com')
//       .post('/purge/main--repo--owner.hlx.live/styles.js')
//       .reply(500)
//       .post(/^\/purge\/main--repo--owner.(?:aem|hlx)(?:-fastly)?\.(?:live|page)\/styles\.js$/)
//       .times(3)
//       .reply(200);
//     nock('https://demo.helix3.page')
//       .intercept('/styles.js', 'PURGE')
//       .reply(200);

// eslint-disable-next-line max-len
//     const result = await performPurge(TEST_CONTEXT(), DEFAULT_INFO, [{ path: '/styles.js' }], PURGE_LIVE);
//     assert.strictEqual(result.status, 502);
//   });
// });
