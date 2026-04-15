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
import { processPrefixedPaths } from '../../src/support/utils.js';

describe('processPrefixedPaths', () => {
  it('splits paths into prefix and path entries', () => {
    const result = processPrefixedPaths(['/docs/*', '/blog/post']);
    assert.deepStrictEqual(result, [
      { prefix: '/docs/' },
      { path: '/blog/post' },
    ]);
  });

  it('removes specific paths covered by wildcard prefix', () => {
    const result = processPrefixedPaths(['/docs/*', '/docs/welcome', '/docs/about']);
    assert.deepStrictEqual(result, [{ prefix: '/docs/' }]);
  });

  it('removes narrower wildcards covered by broader ones', () => {
    const result = processPrefixedPaths(['/docs/sub/*', '/*']);
    assert.deepStrictEqual(result, [{ prefix: '/' }]);
  });

  it('handles empty array', () => {
    const result = processPrefixedPaths([]);
    assert.deepStrictEqual(result, []);
  });

  it('handles only single paths', () => {
    const result = processPrefixedPaths(['/foo', '/bar']);
    assert.deepStrictEqual(result, [
      { path: '/foo' },
      { path: '/bar' },
    ]);
  });
});
