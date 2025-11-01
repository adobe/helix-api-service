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
import {
  computeCodePathKey,
  computeContentPathKey,
  removeRedundantKeys,
  removeRedundantPaths,
} from '../../src/cache/utils.js';

describe('Utils Test', () => {
  it('removeRedundantKeys works', async () => {
    const params = {
      ref: 'ref',
      repo: 'repo',
      owner: 'owner',
      contentBusId: 'contentBusId',
    };
    const paths = ['/foo/bar', '/baz'];
    const keys = await Promise.all(
      paths.map(async (path) => `p_${await computeContentPathKey(params.contentBusId, path)}`),
    );
    const { keys: k, paths: p } = await removeRedundantKeys(params, { keys, paths });
    assert.deepStrictEqual(k, []);
    assert.deepStrictEqual(p, paths);
  });

  it('removeRedundantPaths works', async () => {
    const params = {
      ref: 'ref',
      repo: 'repo',
      owner: 'owner',
      contentBusId: 'contentBusId',
    };
    const paths = ['/foo/bar', '/baz'];
    const keys = await Promise.all(
      paths.map(async (path) => computeCodePathKey(params, path)),
    );
    const { keys: k, paths: p } = await removeRedundantPaths(params, { keys, paths });
    assert.deepStrictEqual(k, keys);
    assert.deepStrictEqual(p, []);
  });
});
