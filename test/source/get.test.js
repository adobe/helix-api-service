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
/* eslint-disable no-param-reassign */
import assert from 'assert';
import { getSource } from '../../src/source/get.js';

describe('Source GET Tests', () => {
  it.only('test getSource', async () => {
    const context = { test: 707 };

    const mockGet = async (p, m) => {
      if (p !== 'test/rest/toast/jam.html') {
        return null;
      }
      m.ContentType = 'text/plain';
      m.timestamp = '12345';
      m.id = '999';
      return 'The body';
    };

    const bucket = {
      get: mockGet,
    };

    const mockS3Storage = {
      sourceBus: () => bucket,
    };

    const info = {
      org: 'test',
      site: 'rest',
      resourcePath: '/toast/jam.html',
    };
    const result = await getSource({ context, info, storage: mockS3Storage });
    assert.equal(result.body, 'The body');
    assert.equal(result.contentType, 'text/plain');
    assert.equal(result.contentLength, 8);
    assert.equal(result.status, 200);
    assert.equal(result.lastModified, '12345');
    assert.equal(result.metadata.id, '999');
  });
});
