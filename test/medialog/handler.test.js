/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-env mocha */
import assert from 'assert';
import crypto from 'crypto';
import sinon from 'sinon';
import { Request } from '@adobe/fetch';
import { MediaLog } from '@adobe/helix-admin-support';
import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

describe('MediaLog Handler Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
    nock.siteConfig(SITE_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(method = 'POST') {
    const suffix = '/org/sites/site/medialog';

    const request = new Request(`https://api.aem.live${suffix}`, {
      method,
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    };
    return { request, context };
  }

  it('returns 405 for unsupported method', async () => {
    const { request, context } = setupTest('PUT');
    const response = await main(request, context);

    assert.strictEqual(response.status, 405);
    assert.strictEqual(await response.text(), 'method not allowed');
  });
});

describe('MediaLog Add Tests', () => {
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
    const suffix = '/org/sites/site/medialog';

    const request = new Request(`https://api.aem.live${suffix}`, {
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

  describe('validates input', () => {
    it('sends 400 for missing `entries`', async () => {
      const { request, context } = setupTest({});
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'Adding media logs requires an array in \'entries\'',
      });
    });

    it('sends 400 for `entries` that is not an array', async () => {
      const { request, context } = setupTest({ entries: {} });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'Adding media logs requires an array in \'entries\'',
      });
    });

    it('sends 400 for `entries` that is too large', async () => {
      const { request, context } = setupTest({ entries: new Array(20) });
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
    let capturedMessages;

    beforeEach(() => {
      capturedMessages = [];
      nock('https://sqs.us-east-1.amazonaws.com')
        .post('/', (body) => {
          const { QueueUrl = '' } = body;
          return QueueUrl.split('/').at(-1) === 'helix-media-log.fifo';
        })
        .reply((_, body) => {
          const { Entries } = JSON.parse(body);
          const parsed = JSON.parse(Entries[0].MessageBody);
          parsed.updates.forEach((u) => {
            // eslint-disable-next-line no-param-reassign
            delete u.timestamp;
          });
          capturedMessages.push({ MessageBody: parsed, MessageGroupId: Entries[0].MessageGroupId });
          return [200, JSON.stringify({
            MessageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
            MD5OfMessageBody: crypto.createHash('md5').update(body, 'utf-8').digest().toString('hex'),
          })];
        });
    });

    it('sends a notification and returns 201', async () => {
      const { request, context } = setupTest({
        entries: [{ operation: 'ingest', path: '/media/image.png' }],
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 201);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
      });
      assert.strictEqual(capturedMessages.length, 1);
      const { contentBusId } = SITE_CONFIG.content;
      assert.strictEqual(capturedMessages[0].MessageGroupId, contentBusId);
      assert.strictEqual(capturedMessages[0].MessageBody.contentBusId, contentBusId);
      assert.strictEqual(capturedMessages[0].MessageBody.updates.length, 1);
      assert.strictEqual(capturedMessages[0].MessageBody.updates[0].operation, 'ingest');
      assert.strictEqual(capturedMessages[0].MessageBody.updates[0].path, '/media/image.png');
    });

    it('sends a notification with user information', async () => {
      const authInfo = AuthInfo.Admin()
        .withAuthenticated(true)
        .withProfile({ email: 'bob@example.com' });

      const { request, context } = setupTest({
        entries: [{ operation: 'ingest', path: '/media/image.png' }],
      }, authInfo);
      const response = await main(request, context);

      assert.strictEqual(response.status, 201);
      assert.strictEqual(capturedMessages[0].MessageBody.updates[0].user, 'bob@example.com');
    });

    it('does not override user already present in entry', async () => {
      const authInfo = AuthInfo.Admin()
        .withAuthenticated(true)
        .withProfile({ email: 'bob@example.com' });

      const { request, context } = setupTest({
        entries: [{ operation: 'ingest', path: '/media/image.png', user: 'original@example.com' }],
      }, authInfo);
      const response = await main(request, context);

      assert.strictEqual(response.status, 201);
      assert.strictEqual(capturedMessages[0].MessageBody.updates[0].user, 'original@example.com');
    });
  });
});

describe('MediaLog Query Tests', () => {
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
    const suffix = '/org/sites/site/medialog';
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
    it('sends 400 for bad `since`', async () => {
      const { request, context } = setupTest({ since: '5 decades' });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': '\'since\' should match a number followed by \'s(econds)\', \'m(inutes)\', \'h(ours)\' or \'d(ays)\': 5 decades',
      });
    });

    it('sends 400 for `since` combined with `from`', async () => {
      const { request, context } = setupTest({ from: '2023-09-22', since: '15m' });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': '\'since\' should not be used with either \'from\' or \'to\'',
      });
    });

    it('sends 400 for `from` not smaller than `to`', async () => {
      const { request, context } = setupTest({ from: '2023-09-22', to: '2023-09-22' });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
    });
  });

  describe('valid input', () => {
    let args;

    beforeEach(() => {
      sandbox.stub(MediaLog, 'createReader').returns({
        init: () => {},
        getEntries: (after, before, { limit, maxSize }, location) => {
          args = {
            after, before, limit, maxSize, location,
          };
          return { entries: [], next: null };
        },
        close: () => {},
      });
    });

    it('returns 200 with entries', async () => {
      const { request, context } = setupTest({ since: '1h' });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      const body = await response.json();
      assert.ok(body.from);
      assert.ok(body.to);
      assert.deepStrictEqual(body.entries, []);
      assert.ok(!body.nextToken);
    });

    it('passes correct timespan to reader', async () => {
      const { request, context } = setupTest({ since: '1h' });
      await main(request, context);

      assert.strictEqual(args.before - args.after, 60 * 60 * 1000);
    });

    it('uses `limit` if specified', async () => {
      const { request, context } = setupTest({ from: '2023-09-22', to: '2023-09-23', limit: 500 });
      await main(request, context);

      assert.strictEqual(args.limit, 500);
    });

    it('ignores `limit` if out of range', async () => {
      const { request, context } = setupTest({ from: '2023-09-22', to: '2023-09-23', limit: 9999 });
      await main(request, context);

      assert.strictEqual(args.limit, 1000);
    });
  });

  describe('with pagination', () => {
    it('returns a continuation token if there are more pages', async () => {
      sandbox.stub(MediaLog, 'createReader').returns({
        init: () => {},
        getEntries: () => ({ entries: [], next: { key: 'value' } }),
        close: () => {},
      });

      const { request, context } = setupTest({ from: '2023-09-22', to: '2023-09-23' });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      const { nextToken, links } = await response.json();
      assert.ok(nextToken);
      const link = new URL(links.next);
      assert.strictEqual(link.searchParams.get('nextToken'), nextToken);
    });
  });
});
