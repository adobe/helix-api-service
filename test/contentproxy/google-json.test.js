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
/* eslint-disable no-param-reassign */
import assert from 'assert';
import { resolve } from 'path';
import { Request } from '@adobe/fetch';
import { GoogleClient } from '@adobe/helix-google-support';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { sanitizeHtml } from '../../src/contentproxy/google-json.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';
import { getFormattedCellsSheet } from './fixtures/formatted-cells-sheet.js';
import { getFormattedCellsValues } from './fixtures/formatted-cells-values.js';
import TEST_STRUCTURES_VALUES from './fixtures/structure-values.js';
import TEST_STRUCTURES from './fixtures/structure.js';

describe('Google JSON Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
    GoogleClient.setItemCacheOptions({ max: 1000 });

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/') {
    const suffix = `/org/sites/site/contentproxy${path}`;

    const request = new Request(`https://api.aem.live${suffix}`, {
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        googleApiOpts: { retry: false },
      },
      runtime: { region: 'us-east-1' },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    };
    return { request, context };
  }

  it('gets sheet by id from google', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .folders([{
        mimeType: 'application/vnd.google-apps.folder',
        name: 'deeply',
        id: 123,
      }])
      .folders([{
        mimeType: 'application/vnd.google-apps.folder',
        name: 'nested',
        id: 124,
      }], '123')
      .sheets([{
        mimeType: 'application/vnd.google-apps.sheets',
        name: 'structure.json',
        id: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
        size: 1234,
      }], '124');

    // TODO: create nock for sheets
    nock('https://sheets.googleapis.com')
      .get('/v4/spreadsheets/1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw')
      .reply(200, TEST_STRUCTURES)
      .get('/v4/spreadsheets/1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw/values/Sheet1%21A1%3AZ1000?valueRenderOption=UNFORMATTED_VALUE')
      .reply(200, TEST_STRUCTURES_VALUES);

    const { request, context } = setupTest('/deeply/nested/structure.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-source-location'), 'gdrive:1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw');
    assert.deepStrictEqual((await response.json()).default.data, [
      { depth: '1', name: 'deeply' },
      { depth: '2', name: 'nested' },
      { depth: '3', name: 'folder' },
      { depth: '4', name: 'structure' },
      { depth: '', name: 'null' },
      { depth: '', name: 'undefined' },
      { depth: '0', name: 'zero' },
    ]);
  });

  it('gets missing sheet by id from google', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .folders([]);

    const { request, context } = setupTest('/deeply/nested/structure.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });

  it('handles google api error', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .sheets()
      .reply(429, 'rate limit exceeded.');

    const { request, context } = setupTest('/data.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
  });

  it('handles sheets api error', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .sheets([{
        mimeType: 'application/vnd.google-apps.sheets',
        name: 'data.json',
        id: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
      }]);

    // TODO: create nock for sheets
    nock('https://sheets.googleapis.com')
      .get('/v4/spreadsheets/1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw')
      .reply(200, TEST_STRUCTURES)
      .get('/v4/spreadsheets/1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw/values/Sheet1%21A1%3AZ1000?valueRenderOption=UNFORMATTED_VALUE')
      .reply(429, {
        error: {
          code: 429,
          message: 'rate limit exceeded.',
        },
      });

    const { request, context } = setupTest('/data.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 503);
  });

  async function testGetFormattedCellsFromGoogle(defaultSharedSheetName) {
    nock.google(SITE_CONFIG.content)
      .user()
      .sheets([{
        mimeType: 'application/vnd.google-apps.sheets',
        name: 'formatted-cells.json',
        id: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
      }]);

    // TODO: create nock for sheets
    nock('https://sheets.googleapis.com')
      .get('/v4/spreadsheets/1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw')
      .reply(200, getFormattedCellsSheet(defaultSharedSheetName), { 'content-type': 'application/json' })
      .get(`/v4/spreadsheets/1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw/values/${defaultSharedSheetName}%21A1%3AZ1000?valueRenderOption=UNFORMATTED_VALUE`)
      .reply(200, getFormattedCellsValues(defaultSharedSheetName), { 'content-type': 'application/json' })
      .get('/v4/spreadsheets/1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw')
      .query({
        ranges: `${defaultSharedSheetName}!B1:B12`,
        fields: 'sheets.data.rowData.values(userEnteredValue,userEnteredFormat,textFormatRuns)',
      })
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/formatted-cells-grid.json'), { 'content-type': 'application/json' });

    const { request, context } = setupTest('/formatted-cells.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual((await response.json()).default.data, [
      {
        Content: 'gdrive-/main/spreadsheet.gsheet',
        Text: '<p>This is <strong>bold</strong> and this is <em>italic</em> and this is <code>inline code</code></p>',
      },
      {
        Content: 'format but col is not.',
        Text: '<p>more <code>code</code>. <strong>bold and <em>italic</strong></em> and underline and <del>strike</del>. <a href="https://www.adobe.com/">adobe.com</a>. end.</p>',
      },
      {
        Content: '',
        Text: '<p>no formats<br>but linebreaks</p>',
      },
      {
        Content: 'multiple links test',
        Text: '<p><a href="https://www.adobe.com/">Adobe Link</a><br>'
          + '<a href="/blog/article">Helix Link</a><br>'
          + '<a href="https://www.adobe.com/">Adobe Link</a></p>',
      },
      {
        Content: 'multiple links test with ending content',
        Text: '<p><a href="https://www.adobe.com/">Adobe Link</a><br>'
          + '<a href="/blog/article">Helix Link</a><br>'
          + '<a href="https://www.adobe.com/">Adobe Link</a><br>'
          + 'No Link</p>',
      },
      {
        Content: 'entire cell is a link',
        Text: '<p><a href="https://www.adobe.com/">link</a></p>',
      },
      {
        Content: 'this is an empty cell',
        Text: '',
      },
      {
        Content: 'entire cell is bold and italic',
        Text: '<p><strong><em>Italic and Bold</strong></em></p>',
      },
      {
        Content: 'Test link and underline offsets wrong.',
        Text: '<p>Test <a href="https://www.adobe.com/">link</a> and underline offsets wrong.</p>',
      },
      {
        Content: 'consecutive links',
        Text: '<p><a href="https://www.adobe.com/">link1</a><a href="https://www.hlx.live/">link2</a></p>',
      },
      {
        Content: 'empty cell at end of rows',
        Text: '',
      },
    ]);
  }

  it('gets formatted cells from google (helix-default)', async () => {
    await testGetFormattedCellsFromGoogle('helix-default');
  });

  it('gets formatted cells from google (shared-default)', async () => {
    await testGetFormattedCellsFromGoogle('shared-default');
  });
});

describe('Sanitize HTML tests', () => {
  it('empty string remains empty', () => {
    assert.strictEqual(sanitizeHtml(''), '');
  });

  it('wraps single line with a paragraph', () => {
    assert.strictEqual(sanitizeHtml('\nthis is some text\n'), '<p>this is some text</p>');
  });

  it('adds line breaks', () => {
    assert.strictEqual(sanitizeHtml('\nthis is some text\nand a second line.'), '<p>this is some text<br>and a second line.</p>');
  });

  it('creates paragraphs', () => {
    assert.strictEqual(sanitizeHtml('\na\n\nb\n\nc\nd\n'), '<p>a</p><p>b</p><p>c<br>d</p>');
  });
});
