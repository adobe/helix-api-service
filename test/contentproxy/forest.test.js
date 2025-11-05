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
import { Forest } from '../../src/contentproxy/Forest.js';

const TEST_FS = {
  '': [
    { path: '/zoo', file: true },
  ],
  '/foo': [
    { path: '/foo/file1', file: true },
    { path: '/foo/explicit', file: true },
    { path: '/foo/sub' },
  ],
  '/foo/sub': [
    { path: '/foo/sub/file1', file: true },
  ],
  '/zoo': [
    { path: '/foo/sub/file1', file: true },
  ],
  '/bar': new Error('boom'),
  '/products': [
    { path: '/products/generic' },
    { path: '/products/missing' },
  ],
  '/products/generic': [
    { path: '/products/generic/p1', file: true },
  ],
  '/products/missing': null,
};

class MockForest extends Forest {
  constructor(log, fs) {
    super(log);
    this.fs = fs;
  }

  async listFolder(root, rootPath, relPath) {
    const ret = this.fs[`${rootPath}${relPath}`] ?? null;
    if (ret instanceof Error) {
      throw ret;
    }
    return ret;
  }
}

describe('Forest Tests', () => {
  it('calling abstract method throws', async () => {
    const forest = new Forest(console);
    await assert.rejects(() => forest.listFolder(), Error('abstract method'));
  });

  it('generates the folder and item list', async () => {
    const forest = new MockForest(console, TEST_FS);
    const ret = await forest.generate('root-id', [
      '/foo/*',
      '/bar/*',
      '/zoo',
      '/foo/explicit',
      '/foo/explicit-notfound',
      '/products/missing/folder',
      '/notexist/*',
    ]);
    assert.deepStrictEqual(ret, [
      {
        error: 'Error: boom',
        path: '/bar/*',
        status: 500,
      },
      {
        file: true,
        path: '/foo/explicit',
      },
      {
        path: '/foo/explicit-notfound',
        status: 404,
      },
      {
        file: true,
        path: '/foo/file1',
      },
      {
        file: true,
        path: '/foo/sub/file1',
      },
      {
        path: '/notexist/*',
        status: 404,
      },
      {
        path: '/products/missing/*',
        status: 404,
      },
      {
        path: '/products/missing/folder',
        status: 404,
      },
      {
        file: true,
        path: '/zoo',
      },
    ]);
  });

  it('can abort during folder listing', async () => {
    const forest = new MockForest(console, TEST_FS);
    const ret = await forest.generate('root-id', [
      '/foo/*',
    ], () => false);
    assert.deepStrictEqual(ret, []);
  });

  it('can abort during explicit listing', async () => {
    const forest = new MockForest(console, TEST_FS);
    const ret = await forest.generate('root-id', [
      '/foo/explicit',
    ], () => false);
    assert.deepStrictEqual(ret, []);
  });
});
