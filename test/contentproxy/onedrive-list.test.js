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
import { resolve } from 'path';
import { readFile } from 'fs/promises';
import { AcquireMethod } from '@adobe/helix-onedrive-support';
import { list } from '../../src/contentproxy/onedrive-list.js';
import {
  Nock, SITE_CONFIG, createContext, createInfo,
} from '../utils.js';

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

function specPath(spec) {
  return resolve(__testdir, 'contentproxy', 'fixtures', spec);
}

describe('OneDrive Integration Tests (list)', () => {
  const DEFAULT_QUERY = { $top: 999, $select: 'name,parentReference,file,id,size,webUrl,lastModifiedDateTime' };

  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/', env = ENV) {
    const suffix = `/org/sites/site/contentproxy${path}`;

    const context = createContext(suffix, {
      attributes: { config: SITE_1D_CONFIG },
      env,
    });
    const info = createInfo(suffix, {
      'x-workbook-session-id': 'test-session-id',
    }).withCode('owner', 'repo');
    return { context, info };
  }

  it('Retrieves tree list from onedrive', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('');

    nock('https://graph.microsoft.com/v1.0')
      .get('/drives/drive-id/items/share-id:/documents:/children')
      .query(DEFAULT_QUERY)
      .replyWithFile(200, specPath('onedrive-list-documents.json'), {
        'content-type': 'application/json',
      })
      .get('/drives/b!DyVXacYnlkm_17hZL307Me9vzRzaKwZCpVMBYbPOKaVT_gD5WmlHRbC-PCpiwGPx/items/012VWERIZWQJBQ5XNJVREZAQS4VXFCFLX4/children')
      .query(DEFAULT_QUERY)
      .reply(429) // reply once with 429
      .get('/drives/b!DyVXacYnlkm_17hZL307Me9vzRzaKwZCpVMBYbPOKaVT_gD5WmlHRbC-PCpiwGPx/items/012VWERIZWQJBQ5XNJVREZAQS4VXFCFLX4/children')
      .query(DEFAULT_QUERY)
      .replyWithFile(200, specPath('onedrive-list-documents-folder.json'), {
        'content-type': 'application/json',
      })
      .get('/drives/b!DyVXacYnlkm_17hZL307Me9vzRzaKwZCpVMBYbPOKaVT_gD5WmlHRbC-PCpiwGPx/items/012VWERIZWQJBQ5XNJVREZAQS4VXFCFLX4/children')
      .query({ ...DEFAULT_QUERY, $skiptoken: 1234 })
      .replyWithFile(200, specPath('onedrive-list-documents-folder-next.json'), {
        'content-type': 'application/json',
      });

    const { context, info } = setupTest();
    const result = await list(context, info, ['/documents/*']);

    assert.deepStrictEqual(result, JSON.parse(await readFile(specPath('onedrive-list-result.json'))));
  });

  it('Handles error during tree list from onedrive', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('');

    nock('https://graph.microsoft.com/v1.0')
      .get('/drives/drive-id/items/share-id:/documents:/children')
      .query(DEFAULT_QUERY)
      .replyWithFile(200, specPath('onedrive-list-documents.json'), {
        'content-type': 'application/json',
      })
      .get('/drives/b!DyVXacYnlkm_17hZL307Me9vzRzaKwZCpVMBYbPOKaVT_gD5WmlHRbC-PCpiwGPx/items/012VWERIZWQJBQ5XNJVREZAQS4VXFCFLX4/children')
      .query(DEFAULT_QUERY)
      .reply(500);

    const { context, info } = setupTest();
    const result = await list(context, info, ['/documents/*']);

    assert.deepStrictEqual(result, JSON.parse(await readFile(specPath('onedrive-list-result-error.json'))));
  });

  it('Handles 404 error during tree list from onedrive', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('');

    nock('https://graph.microsoft.com/v1.0')
      .get('/drives/drive-id/items/share-id:/documents:/children')
      .query(DEFAULT_QUERY)
      .replyWithFile(200, specPath('onedrive-list-documents.json'), {
        'content-type': 'application/json',
      })
      .get('/drives/b!DyVXacYnlkm_17hZL307Me9vzRzaKwZCpVMBYbPOKaVT_gD5WmlHRbC-PCpiwGPx/items/012VWERIZWQJBQ5XNJVREZAQS4VXFCFLX4/children')
      .query(DEFAULT_QUERY)
      .reply(404);

    const { context, info } = setupTest();
    const result = await list(context, info, ['/documents/*']);

    assert.deepStrictEqual(result, JSON.parse(await readFile(specPath('onedrive-list-result-404.json'))));
  });

  it('Retrieves list for individual resources', async () => {
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve('');

    nock('https://graph.microsoft.com/v1.0')
      .get('/drives/drive-id/items/share-id/children')
      .query(DEFAULT_QUERY)
      .replyWithFile(200, specPath('onedrive-list-root.json'), {
        'content-type': 'application/json',
      })
      .get('/drives/drive-id/items/share-id:/sub:/children')
      .query(DEFAULT_QUERY)
      .reply(429, '{}', {
        'retry-after': '0.5',
      })
      .get('/drives/drive-id/items/share-id:/sub:/children')
      .query(DEFAULT_QUERY)
      .replyWithFile(200, specPath('onedrive-list-sub.json'), {
        'content-type': 'application/json',
      })
      .get('/drives/drive-id/items/share-id:/folder:/children')
      .query(DEFAULT_QUERY)
      .replyWithFile(200, specPath('onedrive-list-documents-folder.json'), {
        'content-type': 'application/json',
      })
      .get('/drives/drive-id/items/share-id:/folder:/children')
      .query({ ...DEFAULT_QUERY, $skiptoken: 1234 })
      .replyWithFile(200, specPath('onedrive-list-documents-folder-next.json'), {
        'content-type': 'application/json',
      });

    const { context, info } = setupTest();
    const result = await list(context, info, [
      '/document',
      '/folder',
      '/sub/*',
      '/sub/test',
      '/sub/test-not-found',
      '/sample.pdf',
      '/folder/document-one',
      '/folder/not-found',
      '/',
    ]);

    assert.deepStrictEqual(result, JSON.parse(await readFile(specPath('onedrive-list-result-2.json'))));
  });
});
