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
import { Partitioner } from '../../src/index/Partitioner.js';

describe('Index partitioner', () => {
  it('empty updates are returned as-is', async () => {
    const project = {
      key: 'key',
      owner: 'owner',
      repo: 'repo',
      updates: [],
    };
    const chunks = Partitioner.partition(project);
    assert.deepStrictEqual(chunks, [project]);
  });

  it('updates for another backend than onedrive are returned as-is', async () => {
    const project = {
      key: 'key',
      owner: 'owner',
      repo: 'repo',
      updates: Array.from({ length: 101 }, () => ({ type: 'google' })),
    };
    const chunks = Partitioner.partition(project);
    assert.deepStrictEqual(chunks, [project]);
  });

  it('creates another chunk when limit of indices is reached', async () => {
    const project = {
      key: 'key',
      owner: 'owner',
      repo: 'repo',
      updates: Array.from({ length: 11 }, (_, i) => ({ type: 'onedrive', index: `index-${i + 1}` })),
    };
    const chunks = Partitioner.partition(project);
    assert.strictEqual(chunks.length, 2);
  });

  it('creates another chunk when limit of updates is reached', async () => {
    const project = {
      key: 'key',
      owner: 'owner',
      repo: 'repo',
      updates: Array.from({ length: 101 }, (_) => ({ type: 'onedrive', index: 'default' })),
    };
    const chunks = Partitioner.partition(project);
    assert.strictEqual(chunks.length, 2);
  });
});
