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
import { Request, Response } from '@adobe/fetch';
import crypto from 'crypto';
import wrap from '@adobe/helix-shared-wrap';
import { sqsEventAdapter } from '../../src/wrappers/sqs-event-adapter.js';
import { adminContext } from '../../src/support/AdminContext.js';

describe('SQS Event Adapter Tests', () => {
  it('adapts SQS event records', async () => {
    const req = new Request('https://api.aem.live');
    const messageId = crypto.randomUUID();
    const context = {
      log: console,
      runtime: {
        region: 'us-east-1',
        accountId: 'myaccount',
      },
      env: {},
      pathInfo: {
        suffix: '',
      },
      invocation: {},
      records: [{
        messageId,
        body: JSON.stringify({
          method: 'RUN',
          headers: { 'content-type': 'application/json' },
          body: '{ "foo": "bar" }',
          path: '/job/owner/repo/ref/foo',
          roles: ['admin'],
        }),
      }],
    };

    const fn = async (request, ctx) => {
      assert.deepStrictEqual([...ctx.attributes.authInfo.roles.values()], ['admin']);
      assert.strictEqual(ctx.suffix, '/job/owner/repo/ref/foo');
      assert.strictEqual(ctx.attributes.messageId, messageId.substring(0, 8));
      assert.strictEqual(request.method, 'RUN');
      assert.deepStrictEqual(Object.fromEntries(request.headers.entries()), {
        'content-type': 'application/json',
      });
      assert.ok(request instanceof Request);
      return new Response('Hello, world!', { status: 200 });
    };
    const main = wrap(fn)
      .with(adminContext)
      .with(sqsEventAdapter);
    const resp = await main(req, context);
    assert.equal(resp.status, 200);
  });

  it('processes only the first SQS record', async () => {
    const req = new Request('https://api.aem.live');
    const context = {
      log: console,
      runtime: {
        region: 'us-east-1',
        accountId: 'myaccount',
      },
      env: {},
      pathInfo: {
        suffix: '',
      },
      invocation: {},
      records: Array.from({ length: 10 }, (_, i) => ({
        messageId: crypto.randomUUID(),
        body: JSON.stringify({
          method: 'RUN',
          headers: { 'content-type': 'application/json' },
          body: '{ "foo": "bar" }',
          path: `/job/owner/repo/ref/foo-${i + 1}`,
          roles: ['admin'],
        }),
      })),
    };
    const fn = async (request, ctx) => {
      assert.strictEqual(ctx.suffix, '/job/owner/repo/ref/foo-1');
      return new Response('Hello, world!', { status: 200 });
    };
    const main = wrap(fn)
      .with(adminContext)
      .with(sqsEventAdapter);
    const resp = await main(req, context);
    assert.equal(resp.status, 200);
  });
});
