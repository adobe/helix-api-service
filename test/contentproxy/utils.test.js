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

import assert from 'assert';

import {
  rewriteCellUrl, assertValidSheetJSON, computeSourceUrl, addLastModified,
} from '../../src/contentproxy/utils.js';
import { StatusCodeError } from '../../src/support/StatusCodeError.js';

export const validSheet = (overrides = {}) => ({
  ':type': 'sheet',
  limit: 2,
  total: 2,
  offset: 0,
  data: [{
    index: 0,
    value: 'foo',
  }, {
    index: 1,
    value: 'bar',
  }],
  ...overrides,
});

export const validMultiSheet = ({
  names = ['foo', 'bar'],
  version = 3,
  ...overrides
} = {}) => ({
  ':type': 'multi-sheet',
  ':names': names,
  ':version': version,
  ...(Object.fromEntries(names.map((name) => {
    const sheet = validSheet();
    delete sheet[':type'];
    return [name, sheet];
  }))),
  ...overrides,
});

describe('Rewrite URLs test', () => {
  it('returns input for falsy', () => {
    assert.strictEqual(rewriteCellUrl(null), null);
    assert.strictEqual(rewriteCellUrl(''), '');
    assert.strictEqual(rewriteCellUrl(undefined), undefined);
  });

  it('replaces an azure media url', () => {
    assert.strictEqual(rewriteCellUrl('https://hlx.blob.core.windows.net/external/1234#image.gif?w=10&h=10'), './media_1234.gif#w=10&h=10');
    assert.strictEqual(rewriteCellUrl('https://hlx.blob.core.windows.net/external/1234#image.gif'), './media_1234.gif');
    assert.strictEqual(rewriteCellUrl('https://hlx.blob.core.windows.net/external/1234'), './media_1234.jpg');
  });

  it('replaces an helix media url', () => {
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx.live/media_1234.png#width=800&height=600'), './media_1234.png#width=800&height=600');
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx.live/media_1234.png'), './media_1234.png');
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx.page/media_1234.png'), './media_1234.png');
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx3.page/media_1234.png'), './media_1234.png');
  });

  it('replaces an helix url', () => {
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx.page/blog/article'), '/blog/article');
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx.live/blog/article'), '/blog/article');
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx3.page/blog/article'), '/blog/article');
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx3.page/blog/article?a=42'), '/blog/article?a=42');
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx.page'), '/');
  });

  it('replaces an helix url with fragments', () => {
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx.page/blog/article#heading'), '/blog/article#heading');
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx.live/blog/article#heading'), '/blog/article#heading');
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx3.page/blog/article#heading'), '/blog/article#heading');
    assert.strictEqual(rewriteCellUrl('https://main--pages--adobe.hlx3.page/blog/article?a=42#heading'), '/blog/article?a=42#heading');
    assert.strictEqual(rewriteCellUrl('https://mwpw-118214--express-website--adobe.hlx.page/express/experiments/ccx0074/test#how-to-make-flyers'), '/express/experiments/ccx0074/test#how-to-make-flyers');
  });

  it('keeps helix urls for www and admin in place', () => {
    assert.strictEqual(rewriteCellUrl('https://www.hlx.page/docs'), 'https://www.hlx.page/docs');
    assert.strictEqual(rewriteCellUrl('https://admin.hlx.live/api'), 'https://admin.hlx.live/api');
  });

  it('does not replace prod url', () => {
    assert.strictEqual(rewriteCellUrl('https://www.adobe.com/blog/article'), 'https://www.adobe.com/blog/article');
  });
});

describe('assertValidSheetJSON() tests', () => {
  function runCase(obj, err) {
    if (err) {
      assert.throws(() => assertValidSheetJSON(obj), Error(err));
    } else {
      assert.doesNotThrow(() => assertValidSheetJSON(obj));
    }
  }

  function runCases(cases) {
    cases.forEach(({ name, case: unit }) => {
      it(`-> ${name}`, () => {
        runCase(...unit);
      });
    });
  }

  describe('invalid sheets', () => {
    const cases = [
      { name: 'invalid obj', case: [null, 'invalid sheet; expecting object'] },
      { name: 'invalid :type', case: [validSheet({ ':type': 'foo' }), 'invalid sheet; unknown type'] },
      { name: 'missing data', case: [validSheet({ data: undefined }), 'invalid sheet; expecting data array'] },
      { name: 'invalid limit type', case: [validSheet({ limit: '1' }), 'invalid sheet; expecting limit of type number'] },
      { name: 'invalid offset type', case: [validSheet({ offset: undefined }), 'invalid sheet; expecting offset of type number'] },
      { name: 'invalid total type', case: [validSheet({ total: null }), 'invalid sheet; expecting total of type number'] },
    ];

    runCases(cases);
  });

  describe('valid sheets', () => {
    const cases = [
      { name: 'empty data array', case: [validSheet({ data: [] })] },
      { name: 'valid data array', case: [validSheet()] },
    ];

    runCases(cases);

    it('removes additional single meta properties', () => {
      const obj = validSheet({ ':custom': 42 });
      assertValidSheetJSON(obj);
      assert.deepStrictEqual(obj, {
        ':type': 'sheet',
        data: [
          {
            index: 0,
            value: 'foo',
          },
          {
            index: 1,
            value: 'bar',
          },
        ],
        limit: 2,
        offset: 0,
        total: 2,
      });
    });
  });

  describe('invalid multisheets', () => {
    const cases = [
      { name: 'missing names array', case: [validMultiSheet({ ':names': undefined }), 'invalid multisheet; expecting names array'] },
      { name: 'invalid version', case: [validMultiSheet({ version: 'abc' }), 'invalid multisheet; expecting version of type number'] },
      { name: 'names array does not match, additional sheet', case: [validMultiSheet({ ':names': ['foo'] }), 'invalid multisheet; sheet \'bar\' not in names array'] },
      { name: 'names array does not match, sheet missing', case: [validMultiSheet({ ':names': ['foo', 'bar', 'baz'] }), 'invalid multisheet; missing sheets from names array: baz'] },
    ];

    runCases(cases);
  });

  describe('valid multisheets', () => {
    const cases = [
      { name: 'one sheet', case: [validMultiSheet({ names: ['foo'] })] },
      { name: 'multiple sheets', case: [validMultiSheet()] },
    ];

    runCases(cases);

    it('removes additional multisheet meta properties', () => {
      const obj = validMultiSheet({ names: ['foo'], ':custom': 42 });
      assertValidSheetJSON(obj);
      assert.deepStrictEqual(obj, {
        ':names': [
          'foo',
        ],
        ':type': 'multi-sheet',
        ':version': 3,
        foo: {
          data: [
            {
              index: 0,
              value: 'foo',
            },
            {
              index: 1,
              value: 'bar',
            },
          ],
          limit: 2,
          offset: 0,
          total: 2,
        },
      });
    });
  });
});

describe('computeSourceUrl tests', () => {
  it('resolves the source url correctly for index.md', async () => {
    assert.deepStrictEqual(
      await computeSourceUrl(
        console,
        {
          resourcePath: '/index.md',
          ext: '.md',
        },
        { url: 'https://example.com' },
      ),
      new URL('https://example.com/'),
    );
  });

  it('resolves the source url correctly for a document', async () => {
    assert.deepStrictEqual(
      await computeSourceUrl(
        console,
        {
          resourcePath: '/foo/help.md',
          ext: '.md',
        },
        { url: 'https://example.com' },
      ),
      new URL('https://example.com/foo/help'),
    );
  });

  it('resolves the source url correctly for a folder with relative path', async () => {
    assert.deepStrictEqual(
      await computeSourceUrl(
        console,
        {
          resourcePath: '/foo/help/index.md',
          ext: '.md',
        },
        { url: 'https://example.com/bin/?wcmmode=disabled', suffix: '.html' },
      ),
      new URL('https://example.com/bin/foo/help/index.html?wcmmode=disabled'),
    );
  });

  it('resolves the source url correctly for a document with suffix with query', async () => {
    assert.deepStrictEqual(
      await computeSourceUrl(
        console,
        {
          resourcePath: '/foo/help.md',
          ext: '.md',
        },
        { url: 'https://example.com', suffix: '.html?wcmmode=disabled' },
      ),
      new URL('https://example.com/foo/help.html?wcmmode=disabled'),
    );
  });

  it('resolves the source url relative to the mount url', async () => {
    assert.deepStrictEqual(
      await computeSourceUrl(
        console,
        {
          resourcePath: '/foo/help.pdf',
          ext: '.pdf',
        },
        { url: 'https://example.com/bin/content?wcmmode=disabled', suffix: '.html' },
      ),
      new URL('https://example.com/bin/content/foo/help.pdf?wcmmode=disabled'),
    );
  });

  it('merges mountpoint and suffix params', async () => {
    assert.deepStrictEqual(
      await computeSourceUrl(
        console,
        {
          resourcePath: '/foo/help.md',
          ext: '.md',
        },
        { url: 'https://example.com/bin/content?wcmmode=disabled', suffix: '.html?color=green' },
      ),
      new URL('https://example.com/bin/content/foo/help.html?wcmmode=disabled&color=green'),
    );
  });

  it('rejects invalid url', async () => {
    await assert.rejects(
      computeSourceUrl(
        console,
        {
          resourcePath: '/foo/help.pdf',
          ext: '.pdf',
        },
        { url: 'not a valid url', suffix: '.html' },
      ),
      new StatusCodeError('Bad mountpoint URL in fstab', 400),
    );
  });

  it('rejects internal url', async () => {
    await assert.rejects(
      computeSourceUrl(
        console,
        {
          resourcePath: '/foo/help.pdf',
          ext: '.pdf',
        },
        { url: 'http://localhost:8080', suffix: '.html' },
      ),
      new StatusCodeError('markup host is internal or unknown: localhost', 400),
    );
  });
});

describe('addLastModified tests', () => {
  it('uses valid value', () => {
    assert.deepStrictEqual(
      addLastModified({
        a: 'b',
      }, '14 Jun 2017 00:00:00 PDT'),
      {
        a: 'b',
        'last-modified': 'Wed, 14 Jun 2017 07:00:00 GMT',
      },
    );
  });

  it('skips empty value', () => {
    assert.deepStrictEqual(
      addLastModified({
        a: 'b',
      }, null),
      {
        a: 'b',
      },
    );
  });

  it('skips invalid value', () => {
    assert.deepStrictEqual(
      addLastModified({
        a: 'b',
      }, 'tomorrow'),
      {
        a: 'b',
      },
    );
  });
});
