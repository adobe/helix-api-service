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
import { Request } from '@adobe/fetch';
import { computePaths, RequestInfo } from '../../src/support/RequestInfo.js';

describe('RequestInfo Tests', () => {
  it('check computePaths', () => {
    // special cases: '*' and 'plain.html'
    assert.deepStrictEqual(computePaths('/*'), {
      webPath: '/*',
      resourcePath: '/*',
      ext: '',
    });
    assert.deepStrictEqual(computePaths('/index.plain.html'), {
      webPath: '/index.plain.html',
      resourcePath: '/index.md',
      ext: '.md',
    });
    assert.deepStrictEqual(computePaths('/foo/document.plain.html'), {
      webPath: '/foo/document.plain.html',
      resourcePath: '/foo/document.md',
      ext: '.md',
    });

    // starting with a dot
    assert.deepStrictEqual(computePaths('/.hlxignore'), {
      webPath: '/.hlxignore',
      resourcePath: '/.hlxignore',
      ext: '',
    });

    // ending with a '/' or named 'index'
    assert.deepStrictEqual(computePaths('/'), {
      webPath: '/',
      resourcePath: '/index.md',
      ext: '.md',
    });
    assert.deepStrictEqual(computePaths('/index'), {
      webPath: '/',
      resourcePath: '/index.md',
      ext: '.md',
    });

    // no extension or '.html' or '.md'
    assert.deepStrictEqual(computePaths('/document'), {
      webPath: '/document',
      resourcePath: '/document.md',
      ext: '.md',
    });
    assert.deepStrictEqual(computePaths('/document.html'), {
      webPath: '/document.html',
      resourcePath: '/document.html',
      ext: '.html',
    });
    assert.deepStrictEqual(computePaths('/document.md'), {
      webPath: '/document',
      resourcePath: '/document.md',
      ext: '.md',
    });

    // everything else
    assert.deepStrictEqual(computePaths('/image.png'), {
      webPath: '/image.png',
      resourcePath: '/image.png',
      ext: '.png',
    });
  });

  it('check RequestInfo creation', () => {
    // deny .aspx
    assert.strictEqual(
      RequestInfo.create(new Request('http:/localhost'), { org: 'org', path: '/test.aspx' }),
      null,
    );
  });
});
