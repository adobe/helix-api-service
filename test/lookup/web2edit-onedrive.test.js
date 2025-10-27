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
import { AcquireMethod } from '@adobe/helix-onedrive-support';
import web2edit from '../../src/lookup/web2edit.js';
import {
  Nock, SITE_CONFIG, createContext, createInfo,
} from '../utils.js';

const SITE_1D_CONFIG = {
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'onedrive',
      url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
    },
  },
};

const ENV = {
  AZURE_HELIX_SERVICE_CLIENT_ID: 'dummy',
  AZURE_HELIX_SERVICE_CLIENT_SECRET: 'dummy',
  AZURE_HELIX_SERVICE_ACQUIRE_METHOD: AcquireMethod.BY_CLIENT_CREDENTIAL,
};

describe('web2edit OneDrive Tests', () => {
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

  it('looks up a Word document', async () => {
    const suffix = '/owner/sites/repo/status/page';

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve(SITE_1D_CONFIG.content.source.url)
      .getDocument('/page.docx')
      .getFolder('');

    const result = await web2edit(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        data: { editUrl: 'auto' },
        env: ENV,
      }),
      createInfo(suffix),
    );
    assert.deepStrictEqual(result, {
      editContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      editFolders: [{
        name: 'theblog',
        path: '/',
        url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
      }],
      editName: 'page.docx',
      editUrl: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog/page.docx',
      resourcePath: '/page.md',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/document-id',
      status: 200,
      webPath: '/page',
    });
  });

  it('looks up an Excel workbook', async () => {
    const suffix = '/owner/sites/repo/status/page.json';

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve(SITE_1D_CONFIG.content.source.url)
      .getWorkbook('/page.xlsx')
      .getFolder('');

    const result = await web2edit(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        data: { editUrl: 'auto' },
        env: ENV,
      }),
      createInfo(suffix),
    );
    assert.deepStrictEqual(result, {
      editContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      editFolders: [{
        name: 'theblog',
        path: '/',
        url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
      }],
      editName: 'page.xlsx',
      editUrl: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog/page.xlsx',
      resourcePath: '/page.json',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/workbook-id',
      status: 200,
      webPath: '/page.json',
    });
  });

  it('looks up an MD file', async () => {
    const suffix = '/owner/sites/repo/status/page';

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve(SITE_1D_CONFIG.content.source.url)
      .getDocument('/page.docx', { id: null })
      .getChildren([{
        id: 'item-id',
        path: '/page.md',
      }])
      .getFolder(null);

    const result = await web2edit(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        data: { editUrl: 'auto' },
        env: ENV,
      }),
      createInfo(suffix),
    );
    assert.deepStrictEqual(result, {
      editContentType: 'application/octet-stream',
      editFolders: [],
      editUrl: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FTheBlog%2FShared+Documents%2Ftheblog%2Fpage.md&parent=%2Fsites%2FTheBlog%2FShared+Documents%2Ftheblog&p=5',
      resourcePath: '/page.md',
      sourceLastModified: undefined,
      sourceLocation: 'onedrive:/drives/drive-id/items/item-id',
      status: 200,
      webPath: '/page',
    });
  });

  it('looks up an MD file that has a last modified date time', async () => {
    const suffix = '/owner/sites/repo/status/page';

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve(SITE_1D_CONFIG.content.source.url)
      .getDocument('/page.docx', { id: null })
      .getChildren([{
        id: 'item-id',
        path: '/page.md',
        lastModifiedDateTime: 'Thu, 08 Jul 2021 10:04:16 GMT',
      }])
      .getFolder(null);

    const result = await web2edit(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        data: { editUrl: 'auto' },
        env: ENV,
      }),
      createInfo(suffix),
    );
    assert.deepStrictEqual(result, {
      editContentType: 'application/octet-stream',
      editFolders: [],
      editUrl: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FTheBlog%2FShared+Documents%2Ftheblog%2Fpage.md&parent=%2Fsites%2FTheBlog%2FShared+Documents%2Ftheblog&p=5',
      resourcePath: '/page.md',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/item-id',
      status: 200,
      webPath: '/page',
    });
  });
});
