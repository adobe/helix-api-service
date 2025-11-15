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
import { Request } from '@adobe/fetch';
import { AuditLog } from '@adobe/helix-admin-support';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

describe('Log Query Input Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();

    nock.siteConfig(SITE_CONFIG);
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  function setupTest(data) {
    const suffix = '/org/sites/site/log';
    const query = new URLSearchParams(data);

    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      method: 'GET',
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Admin().withAuthenticated(true),
      },
    };
    return { request, context };
  }

  describe('invalid input', () => {
    it('sends 400 for bad \'from\'', async () => {
      const { request, context } = setupTest({
        from: 'boo',
        to: 'boo',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': '\'from\' is not a valid date: boo',
      });
    });

    it('sends 400 for bad `to`', async () => {
      const { request, context } = setupTest({
        from: '2023-09-22',
        to: 'boo',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': '\'to\' is not a valid date: boo',
      });
    });

    it('sends 400 for bad `since`', async () => {
      const { request, context } = setupTest({
        since: '5 decades',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': '\'since\' should match a number followed by \'s(econds)\', \'m(inutes)\', \'h(ours)\' or \'d(ays)\': 5 decades',
      });
    });

    it('sends 400 for `from` not smaller than `to`', async () => {
      const { request, context } = setupTest({
        from: '2023-09-22',
        to: '2023-09-22',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': '\'from\' (2023-09-22) should be smaller than \'to\' (2023-09-22)',
      });
    });

    it('sends 400 for `from` not smaller than `to` with default provided for `from`', async () => {
      const { request, context } = setupTest({
        to: '2023-09-22',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.match(response.headers.get('x-error'), /'from' \([^)]+\) should be smaller than 'to' \(2023-09-22\)/);
    });

    it('sends 400 for `from` not smaller than `to` with default provided for `to`', async () => {
      const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000);
      const { request, context } = setupTest({
        from: nowPlusOneHour.toISOString(),
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.match(response.headers.get('x-error'), /'from' \([^)]+\) should be smaller than 'to' \([^)]+\)/);
    });

    it('sends 400 for `since` specified along with `from`', async () => {
      const { request, context } = setupTest({
        from: '2023-09-22',
        since: '15m',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': '\'since\' should not be used with either \'from\' or \'to\'',
      });
    });
  });

  describe('valid input', () => {
    let args;

    beforeEach(() => {
      sandbox.stub(AuditLog, 'createReader').returns({
        init: () => {},
        getEntries: (after, before, { limit, maxSize }, location) => {
          args = {
            after, before, limit, maxSize, location,
          };
          return { entries: [], next: { key: 'value' } };
        },
        close: () => {},
      });
    });

    it('uses now() for missing `to`', async () => {
      const now = Date.now();

      const { request, context } = setupTest({
        from: '2023-09-22',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert(args.before >= now);
    });

    const spans = [
      { since: '1s', value: 1000 },
      { since: '2m', value: 2 * 60 * 1000 },
      { since: '3h', value: 3 * 60 * 60 * 1000 },
      { since: '4d', value: 4 * 24 * 60 * 60 * 1000 },
    ];

    spans.forEach(({ since, value }) => it(`understands \`since\` with ${since}`, async () => {
      const { request, context } = setupTest({ since });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(args.before - args.after, value);
    }));

    it('use `limit` if specified', async () => {
      const customLimit = 500;

      const { request, context } = setupTest({
        from: '2023-09-22',
        to: '2023-09-23',
        limit: customLimit,
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert(args.limit === customLimit);
    });

    it('ignores `limit` if it is invalid', async () => {
      const { request, context } = setupTest({
        from: '2023-09-22',
        to: '2023-09-23',
        limit: 9999,
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert(args.limit === 1000);
    });

    it('ignores continuation token if it is invalid', async () => {
      const { request, context } = setupTest({
        from: '2023-09-22',
        to: '2023-09-23',
        nextToken: 'boo',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(args.location, null);
    });

    it('returns a continuation token if there are more pages', async () => {
      const { request, context } = setupTest({
        from: '2023-09-22',
        to: '2023-09-23',
        nextToken: 'boo',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      const {
        from, to, nextToken, links,
      } = await response.json();

      assert.notStrictEqual(from, undefined);
      assert.notStrictEqual(to, undefined);

      const link = new URL(links.next);
      assert.strictEqual(link.searchParams.get('nextToken'), nextToken);
    });
  });
});
