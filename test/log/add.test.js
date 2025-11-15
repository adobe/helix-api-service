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
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

describe('Log Add Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(data, authInfo) {
    const suffix = '/org/sites/site/log';
    const query = new URLSearchParams(data);

    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'content-type': 'application/json',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: authInfo ?? AuthInfo.Admin().withAuthenticated(true),
      },
      runtime: {
        accountId: '123456789012',
        region: 'us-east-1',
      },
    };
    return { request, context };
  }

  describe('validate input', () => {
    it('sends 400 for missing `entries`', async () => {
      const { request, context } = setupTest({});
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'Adding logs requires an array in \'entries\'',
      });
    });

    it('sends 400 for `entries` that is not an array', async () => {
      const { request, context } = setupTest({
        entries: {},
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'Adding logs requires an array in \'entries\'',
      });
    });

    it('sends 400 for `entries` that is too large', async () => {
      const { request, context } = setupTest({
        entries: new Array(20),
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'Array in \'entries\' should not contain more than 10 messages',
      });
    });
  });

  describe('validates notification sent', () => {
    const entries = [];

    beforeEach(() => {
      nock.sqs('helix-audit-logger.fifo', entries);
    });

    afterEach(() => {
      entries.length = 0;
    });

    it('sends a notification', async () => {
      const { request, context } = setupTest({
        entries: [
          { message: 'hello world' },
        ],
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 201);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
      });
      assert.deepStrictEqual(entries, [{
        MessageBody: {
          key: 'org/site',
          updates: [{
            org: 'org',
            owner: 'owner',
            ref: 'main',
            repo: 'repo',
            result: {
              contentBusId: SITE_CONFIG.content.contentBusId,
              message: 'hello world',
            },
            site: 'site',
          }],
        },
        MessageGroupId: 'org/site',
      }]);
    });

    it('sends a notification with user information', async () => {
      const authInfo = AuthInfo.Admin()
        .withAuthenticated(true)
        .withProfile({ email: 'bob@example.com' });

      const { request, context } = setupTest({
        entries: [
          { message: 'hello world' },
        ],
      }, authInfo);
      const response = await main(request, context);

      assert.strictEqual(response.status, 201);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
      });
      assert.deepStrictEqual(entries, [{
        MessageBody: {
          key: 'org/site',
          updates: [{
            org: 'org',
            owner: 'owner',
            ref: 'main',
            repo: 'repo',
            result: {
              contentBusId: SITE_CONFIG.content.contentBusId,
              message: 'hello world',
              user: 'bob@example.com',
            },
            site: 'site',
          }],
        },
        MessageGroupId: 'org/site',
      }]);
    });
  });
});
