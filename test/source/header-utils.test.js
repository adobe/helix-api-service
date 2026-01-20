/*
 * Copyright 2026 Adobe. All rights reserved.
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
/* eslint-disable no-param-reassign */
import assert from 'assert';
import { checkConditionals } from '../../src/source/header-utils.js';
import { createContext, createInfo, Nock } from '../utils.js';

describe('Header Utils Tests', () => {
  let context;
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    context = createContext();
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('should return null if there is no condition in headers', async () => {
    const info = createInfo('/o/sites/s/source/xyz.html');
    const response = await checkConditionals(context, info);
    assert.equal(response, null);
  });

  it('should prefer If-Match over If-None-Match', async () => {
    nock.source()
      .headObject('/o/s/xyz.html')
      .reply(200, null, {
        etag: '"abc123"',
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });
    const headers = {
      'If-Match': '*',
      'If-None-Match': '*',
    };
    const info = createInfo('/o/sites/s/source/xyz.html', headers);
    assert.equal(await checkConditionals(context, info), null);
  });

  async function checkCondition(cond, headerValue, status = 200, respHeaders = {
    etag: '"abc123"',
    'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
  }) {
    nock.source()
      .headObject('/o/s/xyz.html')
      .reply(status, null, respHeaders);
    const headers = {
      [cond]: headerValue,
    };
    const info = createInfo('/o/sites/s/source/xyz.html', headers);
    return checkConditionals(context, info);
  }

  describe('If-Match condition', () => {
    it('should return an error if document is not found for *', async () => {
      const resp = await checkCondition('If-Match', '*', 404, {});
      assert.equal(resp.status, 412);
    });

    it('should return an error if document is not found', async () => {
      const resp = await checkCondition('If-Match', '"abc123"', 404, {});
      assert.equal(resp.status, 412);
    });

    it('should return null when condition is met with *', async () => {
      const resp = await checkCondition('If-Match', '*');
      assert.equal(resp, null);
    });

    it('should return null when condition is met', async () => {
      const resp = await checkCondition('If-Match', '"abc123"');
      assert.equal(resp, null);
    });

    it('should return error response when condition is not met', async () => {
      const resp3 = await checkCondition('If-Match', '"321cba"');
      assert.equal(resp3.status, 412);
    });
  });

  describe('If-None-Match condition', () => {
    it('should return null if document is not found for *', async () => {
      const resp = await checkCondition('If-None-Match', '*', 404, {});
      assert.equal(resp, null);
    });

    it('should return null if document is not found', async () => {
      const resp = await checkCondition('If-None-Match', '"abc123"', 404, {});
      assert.equal(resp, null);
    });

    it('should return an error if document is found for *', async () => {
      const resp = await checkCondition('If-None-Match', '*', 200);
      assert.equal(resp.status, 412);
    });

    it('should return an error if document is found', async () => {
      const resp = await checkCondition('If-None-Match', '"abc123"', 200);
      assert.equal(resp.status, 412);
    });

    it('should return null if document is found with non-matching etag', async () => {
      const resp = await checkCondition('If-None-Match', '"321cba"', 200);
      assert.equal(resp, null);
    });
  });
});
