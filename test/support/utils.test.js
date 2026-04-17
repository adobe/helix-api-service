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
import sinon from 'sinon';
import { Response } from '@adobe/fetch';
import { getSheetData } from '../../src/contentproxy/utils.js';
import {
  applyCustomHeaders, coerceArray, getOrCreateObject, getSanitizedPath,
  isIllegalPath, logStack, processPrefixedPaths, redactObject,
} from '../../src/support/utils.js';
import { createContext, createInfo, Nock } from '../utils.js';

describe('ContentProxy Utils Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('tests `getSheetData`', () => {
    assert.deepStrictEqual(getSheetData({
      custom: {
        data: [],
      },
    }, ['custom']), []);
  });

  it('tests `getSanitizedPath`', () => {
    assert.deepStrictEqual(getSanitizedPath('/page', false), {
      illegalPath: false,
      path: '/page',
    });
  });

  it('tests `isIllegalPath`', () => {
    assert.strictEqual(isIllegalPath(undefined), true);
    assert.strictEqual(isIllegalPath('/*'), true);
    assert.strictEqual(isIllegalPath('/*', true), false);
  });
});

describe('applyCustomHeaders', () => {
  const suffix = '/org/sites/site/status/tools/sidekick/';

  it('applies custom headers', () => {
    const context = createContext(suffix);
    const info = createInfo(suffix);
    const response = new Response('Hello, world!');

    applyCustomHeaders(context, info, response);

    assert.deepStrictEqual(response.headers.plain(), {
      'access-control-allow-origin': '/.*/',
      'content-type': 'text/plain; charset=utf-8',
    });
  });
});

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

describe('coerceArray', () => {
  it('creates unique array', () => {
    assert.deepStrictEqual(coerceArray(['foo', 'foo'], true), ['foo']);
  });
});

describe('logStack', () => {
  it('log TypeError', () => {
    const stub = sinon.stub(console, 'debug');

    try {
      throw new TypeError('test');
    } catch (e) {
      logStack(console, e);
    }

    assert.strictEqual(stub.callCount, 1);
  });
});

describe('getOrCreateObject', () => {
  it('creates object', () => {
    const obj = {};
    getOrCreateObject(obj, 'a.b.c');
    assert.deepStrictEqual(obj, { a: { b: { c: {} } } });
  });
});

describe('redactObject', () => {
  it('returns empty object if allowList is not an array', () => {
    assert.deepStrictEqual(redactObject(null, {}), {});
  });
});
