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
import esmock from 'esmock';

describe('Source GET Tests', () => {
  it('test getSource', async () => {
    const ctx = { test: 707 };

    const mockGet = (p, m) => {
      if (p !== 'test/toast/jam.html') {
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

    const mockS3Storage = (c) => {
      if (c === ctx) {
        return {
          bucket: () => bucket,
        };
      }
      return null;
    };

    const { getSource } = await esmock('../../src/source/get.js', {
      '../../src/source/utils.js': {
        getS3Storage: mockS3Storage,
      },
    });

    const inf = {
      org: 'test',
      resourcePath: '/toast/jam.html',
    };
    const result = await getSource(ctx, inf);
    assert.equal(result.body, 'The body');
    assert.equal(result.contentType, 'text/plain');
    assert.equal(result.contentLength, 8);
    assert.equal(result.status, 200);
    assert.equal(result.lastModified, '12345');
    assert.equal(result.metadata.id, '999');
  });
});
