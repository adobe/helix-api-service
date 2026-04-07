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
import { BatchedQueueClient } from '@adobe/helix-admin-support';
import { IndexMessages } from '../../src/index/IndexMessages.js';
import { createContext } from '../utils.js';

describe('Index Messages Tests', () => {
  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  /** @type {object[]} */
  let payloads;

  /** @type {IndexMessages} */
  let indexMessages;

  /** @type {import('../../src/support/AdminContext').AdminContext} */
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(BatchedQueueClient.prototype, 'send').callsFake((p) => {
      payloads = p;
      return p.map(() => crypto.randomUUID());
    });
    indexMessages = new IndexMessages('org', 'site', {
      maxMessageSize: 1000,
      thresholdFifo: 5,
    });
    context = createContext('/org/sites/site/index/*');
  });

  afterEach(() => {
    payloads = null;
    sandbox.restore();
  });

  it('skips message if it exceeds the max message size', async () => {
    const { log } = context;

    indexMessages.appendChanged('default', 'google', {
      path: '/en/',
      data: 'x'.repeat(1000),
    }, log);

    const { messages } = indexMessages;
    assert.strictEqual(messages.length, 0);
  });

  it('sends individual updates when the threshold is not reached', async () => {
    const { log } = context;

    for (let i = 0; i < 5; i += 1) {
      indexMessages.appendChanged('default', 'google', {
        path: `/en/document${i}`,
      }, log);
    }
    await indexMessages.send(context);

    assert.strict(payloads.length, 5);
  });

  it('sends one composite update when the threshold is reached', async () => {
    const { log } = context;

    for (let i = 0; i < 10; i += 1) {
      indexMessages.appendChanged('default', 'google', {
        path: `/en/document${i}`,
      }, log);
    }
    await indexMessages.send(context);

    assert.strict(payloads.length, 1);
    const { updates } = JSON.parse(payloads[0].MessageBody);
    assert.strictEqual(updates.length, 10);
  });
});
