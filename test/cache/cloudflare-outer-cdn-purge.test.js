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
import { computeSurrogateKey } from '@adobe/helix-shared-utils';
import purge, { PURGE_LIVE } from '../../src/cache/purge.js';
import resolve from '../../src/cache/resolve.js';
import { createContext, createInfo, Nock } from '../utils.js';

describe('Cloudflare Outer CDN Purge Tests', () => {
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

  /**
   * Compute surrogate keys.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @returns {Promise<string[]} surrogate keys
   */
  async function computeSurrogateKeys(context, info) {
    const { attributes: { config: { content: { contentBusId } } } } = context;

    const contentPathKey = await computeSurrogateKey(`${contentBusId}${info.webPath}`);
    const codePathKey = await computeSurrogateKey(`${info.ref}--${info.repo}--${info.owner}${info.webPath}`);

    return [
      contentPathKey,
      codePathKey,
    ];
  }

  const ENV = {
    HLX_FASTLY_PURGE_TOKEN: '1234',
    CLOUDFLARE_PURGE_TOKEN: 'token',
    HLX_CLOUDFLARE_LIVE_ZONE_ID: 'zone1',
    HLX_LIVE_ZONE_ID: 'zone2',
    AEM_CLOUDFLARE_LIVE_ZONE_ID: 'zone3',
    AEM_LIVE_ZONE_ID: 'zone4',
  };

  it('purges Cloudflare live zones by url', async () => {
    const suffix = '/org/sites/site/cache/';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

    const tags = await computeSurrogateKeys(context, info);

    // live
    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' })
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' });
    nock('https://api.cloudflare.com')
      // cloudflare live
      .intercept(/^\/client\/v4\/zones\/zone[1-4]\/purge_cache$/, 'POST')
      .times(4)
      .reply(200, function f(uri, body) {
        assert.deepStrictEqual(body, {
          tags,
        });
        assert.strictEqual(this.req.headers.authorization, 'Bearer token');
        return {
          result: { id: '1234' },
          success: true,
          errors: [],
          messages: [],
        };
      });

    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from purging Cloudflare live cdn by url', async () => {
    // live
    nock('https://api.fastly.com')
      .intercept('/service/1PluOUd9jqp1prQ8PHd85n/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' })
      .intercept('/service/In8SInYz3UQGjyG0GPZM42/purge', 'POST')
      .reply(200, { status: 'ok', id: '12345' });
    nock('https://api.cloudflare.com')
      // cloudflare live
      .intercept(/^\/client\/v4\/zones\/zone1\/purge_cache$/, 'POST')
      .reply(500)
      .intercept(/^\/client\/v4\/zones\/zone[2-4]\/purge_cache$/, 'POST')
      .times(3)
      .reply(200, {
        result: { id: '1234' },
        success: true,
        errors: [],
        messages: [],
      });

    const suffix = '/org/sites/site/cache/';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix);

    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });

  it('purges Cloudflare live cdn by key', async () => {
    const suffix = '/org/sites/site/cache/query-index.json';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

    const tags = await computeSurrogateKeys(context, info);

    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: tags,
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: tags,
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });
    nock('https://api.cloudflare.com')
      // cloudflare live
      .intercept(/^\/client\/v4\/zones\/zone[1-4]\/purge_cache$/, 'POST')
      .times(4)
      .reply(200, function f(uri, body) {
        assert.deepStrictEqual(body, {
          tags,
        });
        assert.strictEqual(this.req.headers.authorization, 'Bearer token');
        return {
          result: { id: '1234' },
          success: true,
          errors: [],
          messages: [],
        };
      });

    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 200);
  });

  it('handles error from purging Cloudflare live cdn by key', async () => {
    const suffix = '/org/sites/site/cache/query-index.json';
    const context = createContext(suffix, { env: ENV });
    const info = createInfo(suffix).withCode('owner', 'repo').withRef('ref');

    const tags = await computeSurrogateKeys(context, info);

    // live
    nock('https://api.fastly.com')
      .post('/service/1PluOUd9jqp1prQ8PHd85n/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: tags,
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      })
      .post('/service/In8SInYz3UQGjyG0GPZM42/purge')
      .reply(function f(uri, body) {
        assert.deepStrictEqual(body, {
          surrogate_keys: tags,
        });
        assert.strictEqual(this.req.headers['fastly-key'], '1234');
        return [200];
      });

    nock('https://api.cloudflare.com')
      // cloudflare live
      .intercept(/^\/client\/v4\/zones\/zone1\/purge_cache$/, 'POST')
      .reply(500)
      .intercept(/^\/client\/v4\/zones\/zone[2-4]\/purge_cache$/, 'POST')
      .times(3)
      .reply(200, {
        result: { id: '1234' },
        success: true,
        errors: [],
        messages: [],
      });

    const result = await purge.resource(context, info, PURGE_LIVE);
    assert.strictEqual(result.status, 502);
  });
});
