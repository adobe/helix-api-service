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

// TODO: remove
/* eslint-disable no-unused-vars, max-len */

/* eslint-env mocha */
import assert from 'assert';
import { randomUUID } from 'crypto';
import purge, { PURGE_LIVE, PURGE_PREVIEW_AND_LIVE } from '../../src/cache/purge.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

const CONFIG_INVALID = {
  data: [{
    key: 'cdn.prod.type',
    value: 'unknown',
  }],
};

const CONFIG_INVALID_NO_TYPE = {
  data: [{
    key: 'cdn.prod.host',
    value: 'demo.helix3.page',
  }],
};

const CONFIG_CLOUDFLARE = {
  data: [{
    key: 'cdn.prod.host',
    value: 'demo.helix3.page',
  },
  {
    key: 'cdn.prod.type',
    value: 'cloudflare',
  },
  {
    key: 'cdn.prod.zoneId',
    value: '12345678',
  },
  {
    key: 'cdn.prod.apiToken',
    value: 'abcdefgh',
  }],
};

const CONFIG_CLOUDFLARE_INVALID = {
  data: [{
    key: 'cdn.prod.host',
    value: 'demo.helix3.page',
  },
  {
    key: 'cdn.prod.type',
    value: 'cloudflare',
  }],
};

const CONFIG_CLOUDFLARE_ENTERPRISE = {
  data: [
    ...(CONFIG_CLOUDFLARE.data),
    {
      key: 'cdn.prod.plan',
      value: 'enterprise',
    },
  ],
};

const CONFIG_FASTLY = {
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
    value: '123456abc',
  },
  {
    key: 'cdn.prod.authToken',
    value: 'abcdefgh',
  }],
};

const CONFIG_AKAMAI = {
  data: [{
    key: 'cdn.prod.host',
    value: 'demo.helix3.page',
  },
  {
    key: 'cdn.prod.type',
    value: 'akamai',
  },
  {
    key: 'cdn.prod.endpoint',
    value: 'abcdefgh.luna.akamaiapis.net',
  },
  {
    key: 'cdn.prod.clientSecret',
    value: 'abcdefgh',
  },
  {
    key: 'cdn.prod.clientToken',
    value: 'abcdefgh',
  },
  {
    key: 'cdn.prod.accessToken',
    value: 'abcdefgh',
  }],
};

const CONFIG_CLOUDFRONT = {
  data: [{
    key: 'cdn.prod.host',
    value: 'demo.helix3.page',
  },
  {
    key: 'cdn.prod.type',
    value: 'cloudfront',
  },
  {
    key: 'cdn.prod.distributionId',
    value: '123456abc',
  },
  {
    key: 'cdn.prod.accessKeyId',
    value: 'abcdefgh',
  },
  {
    key: 'cdn.prod.secretAccessKey',
    value: 'abcdefgh',
  }],
};

const CONFIG_MANAGED = {
  data: [{
    key: 'cdn.prod.host',
    value: 'demo.helix3.page',
  },
  {
    key: 'cdn.prod.type',
    value: 'managed',
  }],
};

const CONFIG_MANAGED_WITH_ENV_ID = {
  data: [{
    key: 'cdn.prod.host',
    value: 'demo.helix3.page',
  },
  {
    key: 'cdn.prod.envId',
    value: 'p1234-e5678',
  },
  {
    key: 'cdn.prod.type',
    value: 'managed',
  }],
};

const ENV = {
  HLX_FASTLY_PURGE_TOKEN: '1234',
  HLX_ADMIN_MANAGED_SVC_ID: 'abcde12345',
  HLX_ADMIN_MANAGED_PURGE_TOKEN: '54321',
  HLX_ADMIN_MANAGED_PURGEPROXY_TOKEN: '654321',
};

describe('BYO CDN Purge Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function withCdnConfig(config) {
    const cdnConfig = {};
    config.data.forEach(({ key, value }) => {
      const segs = key.split('.');
      const child = segs.slice(0, -1).reduce((parent, seg) => {
        if (!parent[seg]) {
          // eslint-disable-next-line no-param-reassign
          parent[seg] = Object.create(null);
        }
        return parent[seg];
      }, cdnConfig);
      child[segs.at(-1)] = value;
    });
    return {
      ...SITE_CONFIG,
      ...cdnConfig,
    };
  }

  function setupTest(cdnConfig, path = '/') {
    const suffix = `/org/sites/site/cache${path}`;
    const config = withCdnConfig(cdnConfig);
    const context = createContext(suffix, { env: ENV, attributes: { config } });
    const info = createInfo(suffix).withCode('owner', 'repo');
    return { context, info };
  }

  it('handles error from invalid configuration', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' })
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' });

    const { context, info } = setupTest(CONFIG_INVALID);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('ignores purge with no cdn.type', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' })
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' });

    const { context, info } = setupTest(CONFIG_INVALID_NO_TYPE);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('ignores purge with invalid purge client config', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' })
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' });

    const { context, info } = setupTest(CONFIG_CLOUDFLARE_INVALID);
    const result = await purge.resource(context, info, PURGE_PREVIEW_AND_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('purges Akamai production url', async () => {
    // live
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
    // production
    nock('https://abcdefgh.luna.akamaiapis.net')
      .intercept('/ccu/v3/delete/tag/production', 'POST')
      .reply(201, (_uri, body) => {
        assert.deepStrictEqual(body, {
          objects: [
            'DiyvKbkf2MaZORJJ',
            '8lnjgOWBwsoqAQXB',
          ],
        });
        return {
          httpStatus: 201,
          detail: 'Request accepted',
          supportId: '123456',
          purgeId: '123456',
          estimatedSeconds: 5,
        };
      });

    const { context, info } = setupTest(CONFIG_AKAMAI);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Akamai production url purge', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' })
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://abcdefgh.luna.akamaiapis.net')
      .intercept('/ccu/v3/delete/tag/production', 'POST')
      .reply(500);

    const { context, info } = setupTest(CONFIG_AKAMAI);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Akamai production url (coverage)', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept(/^\/purge\/main--(repo--owner|site--org).(?:aem|hlx)(?:-fastly)?\.live\/$/, 'POST')
      .times(4)
      .reply(200, { status: 'ok', id: '12345' });

    // production
    nock('https://abcdefgh.luna.akamaiapis.net')
      .intercept('/ccu/v3/delete/url/production', 'POST')
      .reply(201, (_uri, body) => {
        assert.deepStrictEqual(body, {
          objects: [
            'https://demo.helix3.page/',
          ],
        });
        return {
          httpStatus: 201,
          detail: 'Request accepted',
          supportId: '123456',
          purgeId: '123456',
          estimatedSeconds: 5,
        };
      });

    const { context, info } = setupTest(CONFIG_AKAMAI);
    const result = await purge.perform(context, info, [{ path: '/' }], PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Akamai production url purge (coverage)', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept(/^\/purge\/main--(repo--owner|site--org).(?:aem|hlx)(?:-fastly)?\.live\/$/, 'POST')
      .times(4)
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://abcdefgh.luna.akamaiapis.net')
      .intercept('/ccu/v3/delete/url/production', 'POST')
      .reply(500);

    const { context, info } = setupTest(CONFIG_AKAMAI);
    const result = await purge.perform(context, info, [{ path: '/' }], PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Akamai production surrogate keys', async () => {
    // live
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

    // production
    nock('https://abcdefgh.luna.akamaiapis.net')
      .intercept('/ccu/v3/delete/tag/production', 'POST')
      .reply(201, (_uri, body) => {
        assert.deepStrictEqual(body, {
          objects: [
            'lAKEj4mgHHLiyxX6',
            'fhy7zxoNym_6JoRo',
          ],
        });
        return {
          httpStatus: 201,
          detail: 'Request accepted',
          supportId: '123456',
          purgeId: '123456',
          estimatedSeconds: 5,
        };
      });

    const { context, info } = setupTest(CONFIG_AKAMAI, '/en/query-index.json');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Akamai production surrogate keys purge', async () => {
    // live
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
    // production
    nock('https://abcdefgh.luna.akamaiapis.net')
      .intercept('/ccu/v3/delete/tag/production', 'POST')
      .reply(500);
    const { context, info } = setupTest(CONFIG_AKAMAI, '/head');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Cloudflare production url (enterprise)', async () => {
    // live
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
    // production
    nock('https://api.cloudflare.com')
      .intercept('/client/v4/zones/12345678/purge_cache', 'POST')
      .reply(200, function f(uri, body) {
        assert.deepStrictEqual(body, {
          tags: [
            'DiyvKbkf2MaZORJJ',
            '8lnjgOWBwsoqAQXB',
          ],
        });
        assert.strictEqual(this.req.headers.authorization, 'Bearer abcdefgh');
        return {
          result: { id: '1234' },
          success: true,
          errors: [],
          messages: [],
        };
      });

    const { context, info } = setupTest(CONFIG_CLOUDFLARE_ENTERPRISE);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Cloudflare production url purge (enterprise)', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' })
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://api.cloudflare.com')
      .intercept('/client/v4/zones/12345678/purge_cache', 'POST')
      .reply(500);

    const { context, info } = setupTest(CONFIG_CLOUDFLARE_ENTERPRISE);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Cloudflare production url (enterprise) (coverage)', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept(/^\/purge\/main--(repo--owner|site--org).(?:aem|hlx)(?:-fastly)?\.live\/$/, 'POST')
      .times(4)
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://api.cloudflare.com')
      .intercept('/client/v4/zones/12345678/purge_cache', 'POST')
      .reply(200, function f(uri, body) {
        assert.deepStrictEqual(body, {
          tags: [
            '/',
          ],
        });
        assert.strictEqual(this.req.headers.authorization, 'Bearer abcdefgh');
        return {
          result: { id: '1234' },
          success: true,
          errors: [],
          messages: [],
        };
      });

    const { context, info } = setupTest(CONFIG_CLOUDFLARE_ENTERPRISE);
    const result = await purge.perform(context, info, [{ path: '/' }], PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Cloudflare production url purge (enterprise) (coverage)', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept(/^\/purge\/main--(repo--owner|site--org).(?:aem|hlx)(?:-fastly)?\.live\/$/, 'POST')
      .times(4)
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://api.cloudflare.com')
      .intercept('/client/v4/zones/12345678/purge_cache', 'POST')
      .reply(500);

    const { context, info } = setupTest(CONFIG_CLOUDFLARE_ENTERPRISE);
    const result = await purge.perform(context, info, [{ path: '/' }], PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Cloudflare production surrogate keys (enterprise)', async () => {
    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    // production
    nock('https://api.cloudflare.com')
      .intercept('/client/v4/zones/12345678/purge_cache', 'POST')
      .reply(200, function f(uri, body) {
        assert.deepStrictEqual(body, {
          tags: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers.authorization, 'Bearer abcdefgh');
        return {
          result: { id: '1234' },
          success: true,
          errors: [],
          messages: [],
        };
      });

    const { context, info } = setupTest(CONFIG_CLOUDFLARE_ENTERPRISE, '/query-index.json');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Cloudflare production surrogate keys purge (enterprise)', async () => {
    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    // production
    nock('https://api.cloudflare.com')
      .intercept('/client/v4/zones/12345678/purge_cache', 'POST')
      .reply(500);

    const { context, info } = setupTest(CONFIG_CLOUDFLARE_ENTERPRISE, '/query-index.json');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('handles failure from Cloudflare production surrogate keys purge (enterprise)', async () => {
    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    // production
    nock('https://api.cloudflare.com')
      .intercept('/client/v4/zones/12345678/purge_cache', 'POST')
      .reply(200, {
        result: { id: '1234' },
        success: false,
        errors: [{ code: 1016, message: 'One or more cache purge errors' }],
        messages: [],
      });

    const { context, info } = setupTest(CONFIG_CLOUDFLARE_ENTERPRISE, '/query-index.json');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Fastly production url', async () => {
    // live
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
    // production
    nock('https://api.fastly.com')
      .post('/service/123456abc/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'DiyvKbkf2MaZORJJ',
            '8lnjgOWBwsoqAQXB',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
        return [200];
      });

    const { context, info } = setupTest(CONFIG_FASTLY);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Fastly production url purge', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' })
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://api.fastly.com')
      .post('/service/123456abc/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'DiyvKbkf2MaZORJJ',
            '8lnjgOWBwsoqAQXB',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
        return [500];
      });

    const { context, info } = setupTest(CONFIG_FASTLY);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Fastly production url (coverage)', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept(/^\/purge\/main--(repo--owner|site--org).(?:aem|hlx)(?:-fastly)?\.live\/$/, 'POST')
      .times(4)
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://demo.helix3.page')
      .intercept('/', 'PURGE')
      .reply(200, { status: 'ok', id: '12345' });

    const { context, info } = setupTest(CONFIG_FASTLY);
    const result = await purge.perform(context, info, [{ path: '/' }], PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Fastly production url purge (coverage)', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept(/^\/purge\/main--(repo--owner|site--org).(?:aem|hlx)(?:-fastly)?\.live\/$/, 'POST')
      .times(4)
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://demo.helix3.page')
      .intercept('/', 'PURGE')
      .reply(500);

    const { context, info } = setupTest(CONFIG_FASTLY);
    const result = await purge.perform(context, info, [{ path: '/' }], PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Fastly production surrogate keys', async () => {
    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    // production
    nock('https://api.fastly.com')
      .post('/service/123456abc/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], 'abcdefgh');
        return [200];
      });

    const { context, info } = setupTest(CONFIG_FASTLY, '/query-index.json');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Fastly production surrogate keys purge', async () => {
    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    // production
    nock('https://api.fastly.com')
      .post('/service/123456abc/purge')
      .reply(500);

    const { context, info } = setupTest(CONFIG_FASTLY, '/query-index.json');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Cloudfront production url', async () => {
    // live
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
    // production
    nock('https://cloudfront.amazonaws.com')
      .intercept('/2020-05-31/distribution/123456abc/invalidation', 'POST')
      .reply(201, (_uri, body) => {
        assert.match(body, /<Paths><Quantity>2<\/Quantity><Items><Path>\/<\/Path><Path>\/index.plain.html<\/Path><\/Items><\/Paths>/);
        return `<?xml version="1.0"?>\n<Invalidation xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><Id>ABCDEF1234567890</Id><Status>InProgress</Status><CreateTime>${new Date().toISOString()}</CreateTime><InvalidationBatch><Paths><Quantity>2</Quantity><Items><Path>/</Path><Path>/index.plain.html</Path></Items></Paths><CallerReference>${randomUUID()}</CallerReference></InvalidationBatch></Invalidation>`;
      });

    const { context, info } = setupTest(CONFIG_CLOUDFRONT);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('purges Cloudfront production url with special characters', async () => {
    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            '5ufrCpX0uu5ELNnu',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            '5ufrCpX0uu5ELNnu',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    // production
    nock('https://cloudfront.amazonaws.com')
      .intercept('/2020-05-31/distribution/123456abc/invalidation', 'POST')
      .reply(201, (_uri, body) => {
        assert.match(body, /<Paths><Quantity>1<\/Quantity><Items><Path>\/test&lt;bad&gt;&lt;\/bad&gt;.html<\/Path><\/Items><\/Paths>/);
        return `<?xml version="1.0"?>\n<Invalidation xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><Id>ABCDEF1234567890</Id><Status>InProgress</Status><CreateTime>${new Date().toISOString()}</CreateTime><InvalidationBatch><Paths><Quantity>2</Quantity><Items><Path>/</Path><Path>/index.plain.html</Path></Items></Paths><CallerReference>${randomUUID()}</CallerReference></InvalidationBatch></Invalidation>`;
      });

    const { context, info } = setupTest(CONFIG_CLOUDFRONT, '/test<bad></bad>.html');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Cloudfront production url purge', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' })
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://cloudfront.amazonaws.com')
      .intercept('/2020-05-31/distribution/123456abc/invalidation', 'POST')
      .times(1 + 2) // 2 retries
      .reply(500);

    const { context, info } = setupTest(CONFIG_CLOUDFRONT);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it.skip('purging Cloudfront production media url purges all query param variants', async () => {
    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'go_33lQsczpzxqXm',
            'GWJidHlvlxAK1445',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'go_33lQsczpzxqXm',
            'GWJidHlvlxAK1445',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    // production
    nock('https://cloudfront.amazonaws.com')
      .intercept('/2020-05-31/distribution/123456abc/invalidation', 'POST')
      .reply(201, (_uri, body) => {
        assert.match(body, /<Paths><Quantity>1<\/Quantity><Items><Path>\/media_1234567890abcdef1234567890abcdef123456789.jpg\*<\/Path><\/Items><\/Paths>/);
        return `<?xml version="1.0"?>\n<Invalidation xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><Id>ABCDEF1234567890</Id><Status>InProgress</Status><CreateTime>${new Date().toISOString()}</CreateTime><InvalidationBatch><Paths><Quantity>1</Quantity><Items><Path>/query-index.json</Path></Items></Paths><CallerReference>${randomUUID()}</CallerReference></InvalidationBatch></Invalidation>`;
      });

    // TODO: passing a `/media_...` request to PathInfo will always turn `_` into `-`
    //
    // const result = await purge(TEST_CONTEXT(), {
    //   ...DEFAULT_INFO,
    //   path: '/media_1234567890abcdef1234567890abcdef123456789.jpg',
    //   resourcePath: '/media_1234567890abcdef1234567890abcdef123456789.jpg',
    // }, PURGE_LIVE);

    const { context, info } = setupTest(CONFIG_CLOUDFRONT, '/media_1234567890abcdef1234567890abcdef123456789.jpg');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('purging Cloudfront production query-index purges single path', async () => {
    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    // production
    nock('https://cloudfront.amazonaws.com')
      .intercept('/2020-05-31/distribution/123456abc/invalidation', 'POST')
      .reply(201, (_uri, body) => {
        assert.match(body, /<Paths><Quantity>1<\/Quantity><Items><Path>\/query-index.json\*<\/Path><\/Items><\/Paths>/);
        return `<?xml version="1.0"?>\n<Invalidation xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><Id>ABCDEF1234567890</Id><Status>InProgress</Status><CreateTime>${new Date().toISOString()}</CreateTime><InvalidationBatch><Paths><Quantity>1</Quantity><Items><Path>/query-index.json</Path></Items></Paths><CallerReference>${randomUUID()}</CallerReference></InvalidationBatch></Invalidation>`;
      });

    const { context, info } = setupTest(CONFIG_CLOUDFRONT, '/query-index.json');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('purging Cloudfront production surrogate keys triggers purge all', async () => {
    // live
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
            '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f_metadata',
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
            '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f_metadata',
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
    // production
    nock('https://cloudfront.amazonaws.com')
      .intercept('/2020-05-31/distribution/123456abc/invalidation', 'POST')
      .times(2)
      .reply(201, (_uri, body) => {
        assert.match(body, /<Paths><Quantity>1<\/Quantity><Items><Path>\/\*<\/Path><\/Items><\/Paths>/);
        return `<?xml version="1.0"?>\n<Invalidation xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><Id>ABCDEF1234567890</Id><Status>InProgress</Status><CreateTime>${new Date().toISOString()}</CreateTime><InvalidationBatch><Paths><Quantity>1</Quantity><Items><Path>/query-index.json</Path></Items></Paths><CallerReference>${randomUUID()}</CallerReference></InvalidationBatch></Invalidation>`;
      });

    const { context, info } = setupTest(CONFIG_CLOUDFRONT, '/metadata.json');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('purges Adobe-managed (Fastly) production url', async () => {
    // live
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
    // production
    nock('https://purgeproxy.adobeaemcloud.com')
      .post('/purge/demo.helix3.page')
      .reply(function f() {
        assert.strictEqual(this.req.headers['x-aem-purge-key'], '654321');
        assert.strictEqual(this.req.headers['surrogate-key'], 'DiyvKbkf2MaZORJJ 8lnjgOWBwsoqAQXB');
        return [200];
      });

    const { context, info } = setupTest(CONFIG_MANAGED);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('purges Adobe-managed (Fastly) production with envId', async () => {
    // live
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
    // production
    nock('https://purgeproxy.adobeaemcloud.com')
      .post('/purge/p1234-e5678')
      .reply(function f() {
        assert.strictEqual(this.req.headers['surrogate-key'], 'DiyvKbkf2MaZORJJ 8lnjgOWBwsoqAQXB');
        return [200];
      });

    const { context, info } = setupTest(CONFIG_MANAGED_WITH_ENV_ID);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Adobe-managed (Fastly) production url purge', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' })
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://purgeproxy.adobeaemcloud.com')
      .post('/purge/demo.helix3.page')
      .reply(function f() {
        assert.strictEqual(this.req.headers['x-aem-purge-key'], '654321');
        assert.strictEqual(this.req.headers['surrogate-key'], 'DiyvKbkf2MaZORJJ 8lnjgOWBwsoqAQXB');
        return [500];
      });

    const { context, info } = setupTest(CONFIG_MANAGED);
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Adobe-managed (Fastly) production url (coverage)', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept(/^\/purge\/main--(repo--owner|site--org).(?:aem|hlx)(?:-fastly)?\.live\/$/, 'POST')
      .times(4)
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://purgeproxy.adobeaemcloud.com')
      .intercept('/purgeurl/demo.helix3.page/', 'POST')
      .reply(200, { status: 'ok', id: '12345' });

    const { context, info } = setupTest(CONFIG_MANAGED);
    const result = await purge.perform(context, info, [{ path: '/' }], PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from Adobe-managed (Fastly) production url purge (coverage)', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept(/^\/purge\/main--(repo--owner|site--org).(?:aem|hlx)(?:-fastly)?\.live\/$/, 'POST')
      .times(4)
      .reply(200, { status: 'ok', id: '12345' });
    // production
    nock('https://purgeproxy.adobeaemcloud.com')
      .intercept('/purgeurl/demo.helix3.page/', 'POST')
      .reply(500);

    const { context, info } = setupTest(CONFIG_MANAGED);
    const result = await purge.perform(context, info, [{ path: '/' }], PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('handles error from Adobe-managed (Fastly) production surrogate keys purge', async () => {
    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'ymBV5ftMfiPjMqpI',
            'wljKxsUcFS6-GGCx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    // production
    nock('https://purgeproxy.adobeaemcloud.com')
      .post('/purge/demo.helix3.page')
      .reply(500);

    const { context, info } = setupTest(CONFIG_MANAGED, '/query-index.json');
    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });
});
