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
import { AuditLog } from '@adobe/helix-admin-support';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, ORG_CONFIG, SITE_CONFIG } from '../utils.js';

describe('Log Query Input Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  function setupTest(data, callback) {
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
    if (callback) {
      sinon.stub(AuditLog, 'createReader').returns({
        init: () => {},
        getEntries: (...args) => callback(...args),
        close: () => {},
      });
    }
    return { request, context };
  }

  // TODO: write two (or more) describe sections that
  // either check invalid input or what `getEntries`
  // should receive, and what we should get back

  it('uses now() for missing \'to\'', async () => {
    const now = Date.now();

    const { request, context } = setupTest({
      from: '2023-09-22',
    }, (after, before) => {
      assert(before >= now);
      return { entries: [] };
    });
    const result = await main(request, context);

    assert.strictEqual(result.status, 200);
  });

  // it('understands \'since\'', async () => {
  //   const spans = [
  //     { since: '1s', value: 1000 },
  //     { since: '2m', value: 2 * 60 * 1000 },
  //     { since: '3h', value: 3 * 60 * 60 * 1000 },
  //     { since: '4d', value: 4 * 24 * 60 * 60 * 1000 },
  //   ];

  //   stub = sinon.stub(AuditLog, 'createReader').returns({
  //     init: () => {},
  //     getEntries: (after, before) => ({
  //       entries: [{
  //         timespan: before - after,
  //       }],
  //     }),
  //     close: () => {},
  //   });

  //   const results = await Promise.all(spans
  //     .map(async ({ since }) => {
  //       const res = await query(DEFAULT_CONTEXT({ data: { since } }), createPathInfo('/log/org/*/'));
  //       return res.json();
  //     }));
  //   assert.deepStrictEqual(
  //     results.map(({ entries }) => entries[0].timespan),
  //     spans.map(({ value }) => value),
  //   );
  // });

  // it('uses limit if specified', async () => {
  //   const customLimit = 500;
  //   stub = sinon.stub(AuditLog, 'createReader').returns({
  //     init: () => {},
  //     getEntries: (after, before, { limit }) => {
  //       assert(limit === customLimit);
  //       return { entries: [] };
  //     },
  //     close: () => {},
  //   });

  //   await query(DEFAULT_CONTEXT({
  //     data: {
  //       from: '2023-09-22', to: '2023-09-23', limit: customLimit,
  //     },
  //   }), createPathInfo('/log/owner/repo/ref/'));
  // });

  // it('ignores limit if it is invalid', async () => {
  //   stub = sinon.stub(AuditLog, 'createReader').returns({
  //     init: () => {},
  //     getEntries: (after, before, { limit }) => {
  //       assert(limit === 1000);
  //       return { entries: [] };
  //     },
  //     close: () => {},
  //   });

  //   await query(DEFAULT_CONTEXT({
  //     data: {
  //       from: '2023-09-22', to: '2023-09-23', limit: 9999,
  //     },
  //   }), createPathInfo('/log/owner/repo/ref/'));
  // });

  // it('sends 400 for bad \'from\'', async () => {
  //   const res = await query(DEFAULT_CONTEXT({
  //     data: { from: 'boo', to: 'boo' },
  //   }), createPathInfo('/log/owner/repo/ref/'));
  //   assert.strictEqual(res.status, 400);
  //   assert.deepStrictEqual(res.headers.plain(), {
  //     'cache-control': 'no-store, private, must-revalidate',
  //     'content-type': 'text/plain; charset=utf-8',
  //     'x-error': '\'from\' is not a valid date: boo',
  //   });
  // });

  // it('sends 400 for bad \'to\'', async () => {
  //   const res = await query(DEFAULT_CONTEXT({
  //     data: { from: '2023-09-22', to: 'boo' },
  //   }), createPathInfo('/log/owner/repo/ref/'));
  //   assert.strictEqual(res.status, 400);
  //   assert.deepStrictEqual(res.headers.plain(), {
  //     'cache-control': 'no-store, private, must-revalidate',
  //     'content-type': 'text/plain; charset=utf-8',
  //     'x-error': '\'to\' is not a valid date: boo',
  //   });
  // });

  // it('sends 400 for bad \'since\'', async () => {
  //   const res = await query(DEFAULT_CONTEXT({
  //     data: { since: '5 decades' },
  //   }), createPathInfo('/log/owner/repo/ref/'));
  //   assert.strictEqual(res.status, 400);
  //   assert.deepStrictEqual(res.headers.plain(), {
  //     'cache-control': 'no-store, private, must-revalidate',
  //     'content-type': 'text/plain; charset=utf-8',
  //     'x-error': '\'since\' should match a number followed by \'s(econds)\', \'m(inutes)\', \'h(ours)\' or \'d(ays)\': 5 decades',
  //   });
  // });

  // it('sends 400 for \'from\' not smaller than \'to\'', async () => {
  //   const res = await query(DEFAULT_CONTEXT({
  //     data: { from: '2023-09-22', to: '2023-09-22' },
  //   }), createPathInfo('/log/owner/repo/ref/'));
  //   assert.strictEqual(res.status, 400);
  //   assert.deepStrictEqual(res.headers.plain(), {
  //     'cache-control': 'no-store, private, must-revalidate',
  //     'content-type': 'text/plain; charset=utf-8',
  //     'x-error': '\'from\' (2023-09-22) should be smaller than \'to\' (2023-09-22)',
  //   });
  // });

  // it('sends 400 for \'from\' not smaller than \'to\' with default provided for \'from\'', async () => {
  //   const res = await query(DEFAULT_CONTEXT({
  //     data: { to: '2023-09-22' },
  //   }), createPathInfo('/log/owner/repo/ref/'));
  //   assert.strictEqual(res.status, 400);
  //   assert.match(res.headers.get('x-error'), /'from' \([^)]+\) should be smaller than 'to' \(2023-09-22\)/);
  // });

  // it('sends 400 for \'from\' not smaller than \'to\' with default provided for \'to\'', async () => {
  //   const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000);
  //   const res = await query(DEFAULT_CONTEXT({
  //     data: { from: nowPlusOneHour.toISOString() },
  //   }), createPathInfo('/log/owner/repo/ref/'));
  //   assert.strictEqual(res.status, 400);
  //   assert.match(res.headers.get('x-error'), /'from' \([^)]+\) should be smaller than 'to' \([^)]+\)/);
  // });

  // it('sends 400 for \'since\' specified along with \'from\'', async () => {
  //   const res = await query(DEFAULT_CONTEXT({
  //     data: { from: '2023-09-22', since: '15m' },
  //   }), createPathInfo('/log/owner/repo/ref/'));
  //   assert.strictEqual(res.status, 400);
  //   assert.deepStrictEqual(res.headers.plain(), {
  //     'cache-control': 'no-store, private, must-revalidate',
  //     'content-type': 'text/plain; charset=utf-8',
  //     'x-error': '\'since\' should not be used with either \'from\' or \'to\'',
  //   });
  // });

  // it('returns a continuation token if there are more pages', async () => {
  //   stub = sinon.stub(AuditLog, 'createReader').returns({
  //     init: () => {},
  //     getEntries: () => ({ entries: [], next: { key: 'value' } }),
  //     close: () => {},
  //   });

  //   const res = await query(DEFAULT_CONTEXT({ data: {} }), createPathInfo('/log/owner/repo/ref/'));
  //   stub.restore();

  //   const {
  //     from, to, nextToken, links,
  //   } = await res.json();

  //   assert.notStrictEqual(from, undefined);
  //   assert.notStrictEqual(to, undefined);

  //   const link = new URL(links.next);
  //   assert.strictEqual(link.searchParams.get('nextToken'), nextToken);
  // });

  // it('ignores continuation token if it is invalid', async () => {
  //   stub = sinon.stub(AuditLog, 'createReader').returns({
  //     init: () => {},
  //     getEntries: (before, after, _, location) => {
  //       assert.strictEqual(location, null);
  //       return { entries: [] };
  //     },
  //     close: () => {},
  //   });

  //   await query(DEFAULT_CONTEXT({
  //     data: {
  //       from: '2023-09-22', to: '2023-09-23', nextToken: 'boo',
  //     },
  //   }), createPathInfo('/log/owner/repo/ref/'));
  //   stub.restore();
  // });
});
