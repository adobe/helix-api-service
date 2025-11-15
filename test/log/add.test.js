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
import crypto from 'crypto';
import add from '../../src/log/add.js';
import { DEFAULT_CONTEXT, Nock, createPathInfo } from '../utils.js';

describe('Log Add Tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock({ disableAudit: true }).env();
  });

  afterEach(() => {
    nock.done();
  });

  it('sends 400 for missing \'entries\'', async () => {
    const res = await add(DEFAULT_CONTEXT(), createPathInfo('/log/owner/repo/ref/', 'POST'));
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Adding logs requires an array in \'entries\'',
    });
  });

  it('sends 400 for \'entries\' that is not an array', async () => {
    const res = await add(DEFAULT_CONTEXT({
      data: { entries: {} },
    }), createPathInfo('/log/owner/repo/ref/', 'POST'));
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Adding logs requires an array in \'entries\'',
    });
  });

  it('sends 400 for \'entries\' that is too large', async () => {
    const res = await add(DEFAULT_CONTEXT({
      data: { entries: new Array(20) },
    }), createPathInfo('/log/owner/repo/ref/', 'POST'));
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Array in \'entries\' should not contain more than 10 messages',
    });
  });

  it('sends 400 for adding logs to organization', async () => {
    const res = await add(DEFAULT_CONTEXT(), createPathInfo('/log/org/*/', 'POST'));
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Adding logs to an organisation is not supported',
    });
  });

  it('sends a notification', async () => {
    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply((_, body) => {
        const { Entries, QueueUrl } = JSON.parse(body);
        const message = JSON.parse(Entries[0].MessageBody);
        delete message.updates[0].result.timestamp;

        assert.deepStrictEqual(message, {
          key: 'owner/repo',
          updates: [{
            org: 'owner',
            site: 'repo',
            owner: 'owner',
            repo: 'repo',
            ref: 'ref',
            result: {
              message: 'hello world',
              contentBusId: 'foo-id',
            },
          }],
        });
        assert.strictEqual(QueueUrl, 'https://sqs.us-east-1.amazonaws.com/123456789012/helix-audit-logger.fifo');
        return [200, JSON.stringify({
          MessageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
          MD5OfMessageBody: crypto.createHash('md5').update(body, 'utf-8').digest().toString('hex'),
        })];
      });

    const res = await add(DEFAULT_CONTEXT({
      data: { entries: [{ message: 'hello world' }] },
      runtime: { accountId: '123456789012' },
    }), createPathInfo('/log/owner/repo/ref/', 'POST'));
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
    });
  });

  it('sends a notification with user information', async () => {
    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply((_, body) => {
        const { Entries } = JSON.parse(body);
        const message = JSON.parse(Entries[0].MessageBody);

        assert.strictEqual(message.updates[0].result.user, 'john@example.com');
        return [200, JSON.stringify({
          MessageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
          MD5OfMessageBody: crypto.createHash('md5').update(body, 'utf-8').digest().toString('hex'),
        })];
      });

    const res = await add(DEFAULT_CONTEXT({
      data: { entries: [{ message: 'hello world' }] },
      runtime: { accountId: '123456789012' },
      attributes: { authInfo: { resolveEmail: () => 'john@example.com' } },
    }), createPathInfo('/log/owner/repo/ref/', 'POST'));
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
    });
  });
});
