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
import { resolveUniquePaths } from '../../src/snapshot/util.js';

describe('resolveUniquePaths', () => {
  it('deduplicates identical paths', () => {
    const result = resolveUniquePaths(['/foo', '/foo', '/bar']);
    assert.deepStrictEqual(result, ['/foo', '/bar']);
  });

  it('removes specific paths covered by wildcard', () => {
    const result = resolveUniquePaths(['/docs/*', '/docs/welcome', '/docs/about']);
    assert.deepStrictEqual(result, ['/docs/*']);
  });

  it('removes narrower wildcards covered by broader ones', () => {
    const result = resolveUniquePaths(['/docs/sub/*', '/*']);
    assert.deepStrictEqual(result, ['/*']);
  });

  it('keeps independent paths and wildcards', () => {
    const result = resolveUniquePaths(['/docs/*', '/blog/post']);
    assert.deepStrictEqual(result.sort(), ['/blog/post', '/docs/*']);
  });

  it('prepends / to paths without it', () => {
    const result = resolveUniquePaths(['foo', 'bar']);
    assert.deepStrictEqual(result, ['/foo', '/bar']);
  });

  it('handles empty array', () => {
    const result = resolveUniquePaths([]);
    assert.deepStrictEqual(result, []);
  });

  it('handles single wildcard covering all', () => {
    const result = resolveUniquePaths(['/a', '/b', '/*']);
    assert.deepStrictEqual(result, ['/*']);
  });
});
