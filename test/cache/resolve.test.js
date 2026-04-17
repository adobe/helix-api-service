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
import dns from 'node:dns';
import assert from 'assert';
import sinon from 'sinon';
import resolve from '../../src/cache/resolve.js';
import { createContext } from '../utils.js';

describe('Cache Resolve Tests', () => {
  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  /** @type {import('../utils.js').AdminContext} */
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    context = createContext('/org/sites/site/cache/foo');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('resolves CNAME', async () => {
    sandbox.stub(dns, 'Resolver').returns({
      resolveCname: (hostname, callback) => callback(null, [`${hostname}.cloudflare.net`]),
    });
    const cname = await resolve.CName(context, 'www.adobe.com');
    assert.deepStrictEqual(cname, ['www.adobe.com.cloudflare.net']);
  });

  it('throws error', async () => {
    const log = sandbox.stub(context.log, 'error');
    sandbox.stub(dns, 'Resolver').returns({
      resolveCname: (hostname, callback) => callback(new Error('boom!')),
    });
    const cname = await resolve.CName(context, 'www.adobe.com');
    assert.deepStrictEqual(cname, []);
    assert.strictEqual(log.callCount, 1);
  });

  it('returns false if not a cloudflare zone', async () => {
    sandbox.stub(dns, 'Resolver').returns({
      resolveCname: (hostname, callback) => callback(null, [hostname]),
    });
    const isCloudflareZone = await resolve.isCloudflareZone(context, 'www.adobe.com');
    assert.strictEqual(isCloudflareZone, false);
  });
});
