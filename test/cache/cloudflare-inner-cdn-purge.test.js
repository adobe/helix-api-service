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
import sinon from 'sinon';
import purge, { PURGE_PREVIEW } from '../../src/cache/purge.js';
import resolve from '../../src/cache/resolve.js';
import { createContext, createInfo, Nock } from '../utils.js';

describe('Cloudflare Inner CDN Purge Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();

    sandbox.stub(resolve, 'isCloudflareZone').returns(true);
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  const suffix = '/org/sites/site/cache/query-index.json';

  function setupTest() {
    const context = createContext(suffix, {
      env: {
        HLX_FASTLY_PURGE_TOKEN: '1234',
        CLOUDFLARE_PURGE_TOKEN: 'token',
        HLX_CLOUDFLARE_PAGE_ZONE_ID: 'zone1',
        HLX_PAGE_ZONE_ID: 'zone2',
        AEM_CLOUDFLARE_PAGE_ZONE_ID: 'zone3',
        AEM_PAGE_ZONE_ID: 'zone4',
      },
    });
    const info = createInfo(suffix)
      .withCode('owner', 'repo').withRef('ref');

    return { context, info };
  }

  it('purges page url', async () => {
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
    nock('https://api.cloudflare.com')
      // hlx-cloudflare.page
      .intercept('/client/v4/zones/zone1/purge_cache', 'POST')
      .reply(200, function f(uri, body) {
        assert.deepStrictEqual(body, {
          tags: [
            'ref--site--org/helix-config.json',
          ],
        });
        assert.strictEqual(this.req.headers.authorization, 'Bearer token');
        return {
          result: { id: '1234' },
          success: true,
          errors: [],
          messages: [],
        };
      })
      // hlx.page
      .intercept('/client/v4/zones/zone2/purge_cache', 'POST')
      .reply(200, function f(uri, body) {
        assert.deepStrictEqual(body, {
          tags: [
            'ref--site--org/helix-config.json',
          ],
        });
        assert.strictEqual(this.req.headers.authorization, 'Bearer token');
        return {
          result: { id: '1234' },
          success: true,
          errors: [],
          messages: [],
        };
      });

    const { context, info } = setupTest();
    const result = await purge.hlxPage(context, info, ['/helix-config.json']);

    assert.strictEqual(result.status, 200);
  });

  it('purges page url can fail', async () => {
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
    nock('https://api.cloudflare.com')
      // hlx-cloudflare.page
      .intercept('/client/v4/zones/zone1/purge_cache', 'POST')
      .reply(200, function f(uri, body) {
        assert.deepStrictEqual(body, {
          tags: [
            'ref--site--org/helix-config.json',
          ],
        });
        assert.strictEqual(this.req.headers.authorization, 'Bearer token');
        return {
          result: { id: '1234' },
          success: false,
          errors: [],
          messages: [],
        };
      })
      // hlx.page
      .intercept('/client/v4/zones/zone2/purge_cache', 'POST')
      .reply(502, function f(uri, body) {
        assert.deepStrictEqual(body, {
          tags: [
            'ref--site--org/helix-config.json',
          ],
        });
        assert.strictEqual(this.req.headers.authorization, 'Bearer token');
        return {
          result: { id: '1234' },
          success: true,
          errors: [],
          messages: [],
        };
      });

    const { context, info } = setupTest();
    const result = await purge.hlxPage(context, info, ['/helix-config.json']);

    assert.strictEqual(result.status, 502);
  });

  it('purges Cloudflare preview zones by key', async () => {
    // preview
    nock('https://api.fastly.com')
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: [
            'p_ymBV5ftMfiPjMqpI',
            'gkhFlQmxUslocIjx',
          ],
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    nock('https://api.cloudflare.com')
      // cloudflare live
      .intercept(/^\/client\/v4\/zones\/zone[3-4]\/purge_cache$/, 'POST')
      .times(2)
      .reply(200, function f(uri, body) {
        assert.deepStrictEqual(body, {
          tags: [
            'p_ymBV5ftMfiPjMqpI',
            'gkhFlQmxUslocIjx',
          ],
        });
        assert.strictEqual(this.req.headers.authorization, 'Bearer token');
        return {
          result: { id: '1234' },
          success: true,
          errors: [],
          messages: [],
        };
      });

    const { context, info } = setupTest();
    const result = await purge.resource(context, info, PURGE_PREVIEW);

    assert.strictEqual(result.status, 200);
  });
});
