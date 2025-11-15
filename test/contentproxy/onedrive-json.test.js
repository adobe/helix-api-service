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
import { Request } from '@adobe/fetch';
import { AcquireMethod, OneDrive } from '@adobe/helix-onedrive-support';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

const SITE_1D_CONFIG = {
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'onedrive',
      url: 'https://adobe.sharepoint.com/sites/Site/Shared%20Documents/site',
    },
  },
};

const ENV = {
  AZURE_HELIX_SERVICE_CLIENT_ID: 'dummy',
  AZURE_HELIX_SERVICE_CLIENT_SECRET: 'dummy',
  AZURE_HELIX_SERVICE_ACQUIRE_METHOD: AcquireMethod.BY_CLIENT_CREDENTIAL,
};

describe('OneDrive Integration Tests (JSON)', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_1D_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/', env = ENV) {
    const suffix = `/org/sites/site/contentproxy${path}`;

    const request = new Request('https://localhost/', {
      headers: {
        'x-workbook-session-id': 'test-session-id',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
        ...env,
      },
    };
    return { request, context };
  }

  async function testJSONRetrievalFromExcel(defaultSharedSheetPrefix) {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getWorkbook('/redirects.xlsx');

    nock('https://graph.microsoft.com/v1.0')
      .post('/drives/drive-id/items/workbook-id/workbook/application/calculate')
      .reply(204)
      .get('/drives/drive-id/items/workbook-id/workbook/worksheets')
      .matchHeader('Workbook-Session-Id', 'test-session-id')
      .reply(200, {
        value: [{
          id: `${defaultSharedSheetPrefix}-default`,
          name: `${defaultSharedSheetPrefix}-default`,
        },
        {
          id: 'incoming',
          name: 'incoming',
        },
        {
          id: `${defaultSharedSheetPrefix}-japan`,
          name: `${defaultSharedSheetPrefix}-日本`,
        }],
      })
      .get(`/drives/drive-id/items/workbook-id/workbook/worksheets/${defaultSharedSheetPrefix}-default/usedRange?$select=values`)
      .matchHeader('Workbook-Session-Id', 'test-session-id')
      .reply(200, {
        values: [
          ['source', '', 'destination'],
          ['/foo', '', '/bar'],
          ['/folder', '', 42],
          ['/bar', '', true],
          ['/zoo', '', undefined],
          ['/null', '', null],
          ['/zero', '', 0],
          ['', '', ''],
          [' /space\u200B', '', '\u200B/bar '],
        ],
      })
      .get(`/drives/drive-id/items/workbook-id/workbook/worksheets/${defaultSharedSheetPrefix}-%E6%97%A5%E6%9C%AC/usedRange?$select=values`)
      .matchHeader('Workbook-Session-Id', 'test-session-id')
      .reply(200, {
        values: [
          ['country', '', 'value'],
          ['Japan', '', '100'],
        ],
      });

    const { request, context } = setupTest('/redirects.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      ':names': [
        'default',
        '日本',
      ],
      ':type': 'multi-sheet',
      ':version': 3,
      default: {
        columns: [
          'source', 'destination',
        ],
        data: [
          {
            destination: '/bar',
            source: '/foo',
          },
          {
            destination: '42',
            source: '/folder',
          },
          {
            destination: 'true',
            source: '/bar',
          },
          {
            destination: '',
            source: '/zoo',
          },
          {
            destination: '',
            source: '/null',
          },
          {
            destination: '0',
            source: '/zero',
          },
          {
            destination: '/bar',
            source: '/space',
          },
        ],
        limit: 7,
        offset: 0,
        total: 7,
      },
      日本: {
        columns: [
          'country',
          'value',
        ],
        data: [
          {
            country: 'Japan',
            value: '100',
          },
        ],
        limit: 1,
        offset: 0,
        total: 1,
      },
    });
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'application/json',
      'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT',
      'x-source-location': 'onedrive:/drives/drive-id/items/workbook-id',
      'x-sheet-names': `${defaultSharedSheetPrefix}-default,incoming,${defaultSharedSheetPrefix}-%E6%97%A5%E6%9C%AC`,
      vary: 'Accept-Encoding',
    });
  }

  it('Retrieves JSON from excel (helix-default)', async () => {
    await testJSONRetrievalFromExcel('helix');
  });

  it('Retrieves JSON from excel (shared-default)', async () => {
    await testJSONRetrievalFromExcel('shared');
  });

  it('Retrieves workbook with no sheet names as 200', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getWorkbook('/redirects.xlsx');

    nock('https://graph.microsoft.com/v1.0')
      .post('/drives/drive-id/items/workbook-id/workbook/application/calculate')
      .replyWithError('Just here for codecov')
      .get('/drives/drive-id/items/workbook-id/workbook/worksheets')
      .matchHeader('Workbook-Session-Id', 'test-session-id')
      .reply(200, {
        value: [],
      });

    const { request, context } = setupTest('/redirects.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      ':names': [],
      ':type': 'multi-sheet',
      ':version': 3,
    });
  });

  async function testMultisheetJSONRetrievalFromExcel(defaultSharedSheetName) {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getWorkbook('/redirects.xlsx');

    nock('https://graph.microsoft.com/v1.0')
      .post('/drives/drive-id/items/workbook-id/workbook/application/calculate')
      .reply(204)
      .get('/drives/drive-id/items/workbook-id/workbook/worksheets')
      .matchHeader('Workbook-Session-Id', 'test-session-id')
      .reply(200, {
        value: [{
          id: defaultSharedSheetName,
          name: defaultSharedSheetName,
        }, {
          id: 'helix-sitemap',
          name: 'helix-sitemap',
        }],
      })
      .get(`/drives/drive-id/items/workbook-id/workbook/worksheets/${defaultSharedSheetName}/usedRange?$select=values`)
      .matchHeader('Workbook-Session-Id', 'test-session-id')
      .reply(200, {
        values: [
          ['source', 'destination'],
          ['/foo', '/bar'],
        ],
      })
      .get('/drives/drive-id/items/workbook-id/workbook/worksheets/helix-sitemap/usedRange?$select=values')
      .matchHeader('Workbook-Session-Id', 'test-session-id')
      .reply(200, {
        values: [
          ['source', 'destination'],
          ['/hello', '/world'],
        ],
      });

    const { request, context } = setupTest('/redirects.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      ':names': [
        'default',
        'sitemap',
      ],
      ':type': 'multi-sheet',
      ':version': 3,
      default: {
        columns: [
          'source', 'destination',
        ],
        data: [
          {
            destination: '/bar',
            source: '/foo',
          },
        ],
        limit: 1,
        offset: 0,
        total: 1,
      },
      sitemap: {
        columns: [
          'source', 'destination',
        ],
        data: [
          {
            destination: '/world',
            source: '/hello',
          },
        ],
        limit: 1,
        offset: 0,
        total: 1,
      },
    });
    assert.strictEqual(response.headers.get('x-source-location'), 'onedrive:/drives/drive-id/items/workbook-id');
  }

  it('Retrieves multisheet JSON from excel', async () => {
    await testMultisheetJSONRetrievalFromExcel('helix-default');
  });

  it('Retrieves multisheet JSON from excel', async () => {
    await testMultisheetJSONRetrievalFromExcel('shared-default');
  });

  it('Handles 404 from onedrive', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getWorkbook('/redirects.xlsx', { id: null })
      .getChildren([]);

    const { request, context } = setupTest('/redirects.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });

  it('Handles error from onedrive', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login();

    nock('https://graph.microsoft.com/v1.0')
      .get(`/shares/${OneDrive.encodeSharingUrl(SITE_1D_CONFIG.content.source.url)}/driveItem`)
      .replyWithError('kaputt');

    const { request, context } = setupTest('/redirects.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
  });

  it('Handles client error', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user();

    const { request, context } = setupTest('/redirects.json', {});
    const response = await main(request, context);

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.headers.get('x-error'), 'Unable to fetch \'/redirects.json\' from \'onedrive\': Either clientId or accessToken must not be null.');
  });

  it('Handles 429 from sheets api', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getWorkbook('/redirects.xlsx');

    nock('https://graph.microsoft.com/v1.0')
      .post('/drives/drive-id/items/workbook-id/workbook/application/calculate')
      .reply(204)
      .get('/drives/drive-id/items/workbook-id/workbook/worksheets')
      .reply(429, JSON.stringify({
        message: 'We\'re sorry. We ran into a problem completing your request.',
      }), {
        'Content-Type': 'application/json',
        'Retry-After': 233,
      });

    const { request, context } = setupTest('/redirects.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 503);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': '233',
      'x-error': 'Unable to fetch \'/redirects.json\' from \'onedrive\': We\'re sorry. We ran into a problem completing your request.',
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
      'x-severity': 'warn',
    });
  });

  it('Handles 429 from recalculate', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getWorkbook('/redirects.xlsx');

    nock('https://graph.microsoft.com/v1.0')
      .post('/drives/drive-id/items/workbook-id/workbook/application/calculate')
      .reply(429, JSON.stringify({
        message: 'We\'re sorry. We couldn\'t finish what you asked us to do because it was taking too long.',
      }), {
        'Content-Type': 'application/json',
      });

    const { request, context } = setupTest('/redirects.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 503);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to fetch \'/redirects.json\' from \'onedrive\': We\'re sorry. We couldn\'t finish what you asked us to do because it was taking too long.',
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
      'x-severity': 'warn',
    });
  });

  it('Handles 429 from fetching the drive item', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('');

    nock('https://graph.microsoft.com/v1.0')
      .get('/drives/drive-id/items/share-id:/redirects.xlsx')
      .reply(429, JSON.stringify({
        message: 'The request has been throttled',
      }), {
        'Content-Type': 'application/json',
        'Retry-After': 233,
      });

    const { request, context } = setupTest('/redirects.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 503);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': '233',
      'x-error': 'Unable to fetch \'/redirects.json\' from \'onedrive\': (429) - The request has been throttled',
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
      'x-severity': 'warn',
    });
  });

  it('Handles 501 from sheets api', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('')
      .getWorkbook('/redirects.xlsx');

    nock('https://graph.microsoft.com/v1.0')
      .post('/drives/drive-id/items/workbook-id/workbook/application/calculate')
      .reply(204)
      .get('/drives/drive-id/items/workbook-id/workbook/worksheets')
      .reply(501, JSON.stringify({
        message: 'We\'re sorry, but something went wrong with this file.',
      }), {
        'Content-Type': 'application/json',
      });

    const { request, context } = setupTest('/redirects.json');
    const response = await main(request, context);

    assert.strictEqual(response.status, 501);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to fetch \'/redirects.json\' from \'onedrive\': We\'re sorry, but something went wrong with this file.',
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
      'x-severity': 'warn',
    });
  });
});
