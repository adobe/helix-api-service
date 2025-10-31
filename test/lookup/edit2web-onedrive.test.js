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
import { AcquireMethod } from '@adobe/helix-onedrive-support';
import edit2web from '../../src/lookup/edit2web.js';
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

function createURL(url, query) {
  return new URL(`${url}?${new URLSearchParams(query)}`);
}

describe('edit2web OneDrive Tests', () => {
  const suffix = '/owner/sites/repo/status/page';

  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('resolves web resource path for onedrive document', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:w:/r/sites/TheBlog/_layouts/15/Doc.aspx', {
      sourcedoc: '{09BFA93A-78BC-49F6-B93D-990A0ED4D55C}',
      file: 'page.docx',
      action: 'default',
      mobileredirect: 'true',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .getSiteItem('sites/TheBlog', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        id: 'document-id', path: '/page.docx',
      })
      .resolve('/page.docx', {
        id: 'document-id', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'page.docx',
      editContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      editUrl,
      path: '/page',
      resourcePath: '/page.md',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/document-id',
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
    });
  });

  it('resolves web resource path for onedrive document but fails for folders', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:w:/r/sites/TheBlog/_layouts/15/Doc.aspx', {
      sourcedoc: '{09BFA93A-78BC-49F6-B93D-990A0ED4D55C}',
      file: 'page.docx',
      action: 'default',
      mobileredirect: 'true',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .getSiteItem('sites/TheBlog', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        id: 'document-id', path: '/page.docx',
      })
      .resolve('/page.docx', {
        id: 'document-id', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .resolve('')
      .getFolder(null);

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'page.docx',
      editContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      editUrl,
      path: '/page',
      resourcePath: '/page.md',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/document-id',
      editFolders: [],
    });
  });

  it('resolves web resource path for onedrive index document', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:w:/r/sites/TheBlog/_layouts/15/Doc.aspx', {
      sourcedoc: '{09BFA93A-78BC-49F6-B93D-990A0ED4D55C}',
      file: 'index.docx',
      action: 'default',
      mobileredirect: 'true',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .getSiteItem('sites/TheBlog', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        id: 'document-id', path: '/index.docx',
      })
      .resolve('/index.docx', {
        id: 'document-id', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'index.docx',
      editContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      editUrl,
      path: '/',
      resourcePath: '/index.md',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/document-id',
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
    });
  });

  it('resolves web resource path for onedrive document with & in name.', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:x:/r/sites/TheBlog/_layouts/15/Doc.aspx', {
      sourcedoc: '{09BFA93A-78BC-49F6-B93D-990A0ED4D55C}',
      file: 'CMO & DX Content to Migrate.xlsx',
      action: 'default',
      mobileredirect: 'true',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .getSiteItem('sites/TheBlog', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        id: 'workbook-id', path: '/CMO%20%26%20DX%20Content%20to%20Migrate.xlsx',
      })
      .resolve('/CMO%20%26%20DX%20Content%20to%20Migrate.xlsx', {
        id: 'workbook-id', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );
    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'CMO & DX Content to Migrate.xlsx',
      editContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
      editUrl,
      path: '/cmo-dx-content-to-migrate.json',
      resourcePath: '/cmo-dx-content-to-migrate.json',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/workbook-id',
    });
  });

  it('resolves web resource path for onedrive document via sharelink', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:w:/r/sites/TheBlog/_layouts/15/guestaccess.aspx', {
      e: '4:xSM7pa',
      at: '9',
      wdLOR: 'c64EF58AE-CEBB-0540-B444-044062648A17',
      share: 'ERMQVuCr7S5FqIBgvCJezO0BUUxpzherbeKSSPYCinf84w',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve(editUrl.href, { id: '09BFA93A-78BC-49F6-B93D-990A0ED4D55C' })
      .getSiteItem('sites/TheBlog', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        id: 'document-id', path: '/page.docx',
      })
      .resolve('/page.docx', {
        id: 'document-id', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'page.docx',
      editContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      editUrl,
      path: '/page',
      resourcePath: '/page.md',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/document-id',
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
    });
  });

  it('returns not found for onedrive document via invalid sharelink', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:w:/r/sites/TheBlog/_layouts/15/guestaccess.aspx', {
      e: '4:xSM7pa',
      at: '9',
      wdLOR: 'c64EF58AE-CEBB-0540-B444-044062648A17',
      share: 'ERMQVuCr7S5FqIBgvCJezO0BUUxpzherbeKSSPYCinf84x',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve(editUrl.href, { id: null });

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      error: `Handler onedrive could not lookup ${editUrl}.`,
      status: 404,
    });
  });

  it('resolves web resource path for onedrive document with no edit mode markers', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:x:/r/sites/TheBlog/_layouts/15/Doc.aspx', {
      sourcedoc: '{09BFA93A-78BC-49F6-B93D-990A0ED4D55C}',
      file: 'page.docx',
      action: 'default',
      mobileredirect: 'true',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .getSiteItem('sites/TheBlog', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        id: 'document-id', path: '/page.docx',
      })
      .resolve('/page.docx', {
        id: 'document-id', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'page.docx',
      editContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      editUrl,
      path: '/page',
      resourcePath: '/page.md',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/document-id',
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
    });
  });

  it('resolves web resource path for onedrive document with email sharelink', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:w:/s/TheBlog/EfaZv8TXBKtNkDb8MH1HoOsBnwRunv3BxXZ_-XgcEwiqe', {
      e: 'RLSD8R',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve(editUrl.href, { id: '09BFA93A-78BC-49F6-B93D-990A0ED4D55C' })
      .getSiteItem('sites/TheBlog', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        id: 'document-id', path: '/page.docx',
      })
      .resolve('/page.docx', {
        id: 'document-id', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'page.docx',
      editContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      editUrl,
      path: '/page',
      resourcePath: '/page.md',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/document-id',
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
    });
  });

  it('resolves web resource path for onedrive taxonomy spreadsheet', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:x:/r/sites/TheBlog/_layouts/15/Doc.aspx', {
      sourcedoc: '{09BFA93A-78BC-49F6-B93D-990A0ED4D55C}',
      file: '_taxonomy.xlsx',
      action: 'default',
      mobileredirect: 'true',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .getSiteItem('sites/TheBlog', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        id: 'workbook-id', path: '/_taxonomy.xlsx',
      })
      .resolve('/_taxonomy.xlsx', {
        id: 'workbook-id', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );
    assert.deepStrictEqual(result, {
      status: 200,
      editName: '_taxonomy.xlsx',
      editContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
      editUrl,
      path: '/taxonomy.json',
      resourcePath: '/taxonomy.json',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/workbook-id',
    });
  });

  it('resolves web resource path for onedrive document w/o extension', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:x:/r/sites/TheBlog/_layouts/15/Doc.aspx', {
      sourcedoc: '{09BFA93A-78BC-49F6-B93D-990A0ED4D55C}',
      file: 'some-data-test.xlsx',
      action: 'default',
      mobileredirect: 'true',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .getSiteItem('sites/TheBlog', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        id: 'item-id', path: '/some-data-test',
      })
      .resolve('/some-data-test', {
        id: 'item-id', mimeType: null,
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );
    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'some-data-test',
      editContentType: null,
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
      editUrl,
      path: '/some-data-test',
      resourcePath: '/some-data-test.md',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/item-id',
    });
  });

  it('resolves web resource path for onedrive document with author friendly name but illegal folder', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:x:/r/sites/TheBlog/_layouts/15/Doc.aspx', {
      sourcedoc: '{09BFA93A-78BC-49F6-B93D-990A0ED4D55C}',
      file: 'My 1. Döcument!.docx',
      action: 'default',
      mobileredirect: 'true',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .getSiteItem('sites/TheBlog', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        id: 'document-id', path: '/My%20Drafts/My%201.%20D%C3%B6cument!.docx',
      })
      .resolve('/My%20Drafts/My%201.%20D%C3%B6cument!.docx', {
        id: 'document-id', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .resolve('')
      .getFolder('/My%20Drafts');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'My 1. Döcument!.docx',
      editContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      illegalPath: '/My Drafts/My 1. Döcument!.docx',
      editUrl,
      path: '/my-drafts/my-1-document',
      resourcePath: '/my-drafts/my-1-document.md',
      sourceLastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      sourceLocation: 'onedrive:/drives/drive-id/items/document-id',
      editFolders: [
        {
          name: 'My Drafts',
          path: '/My%20Drafts',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog/My%20Drafts',
        },
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
    });
  });

  it('resolves web resource path for onedrive file', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:x:/r/sites/TheBlog/_layouts/15/Doc.aspx', {
      FolderCTID: '0x012000291CC2F215041D41ADE01F0A04AB94F2',
      id: '/sites/TheBlog/Shared Documents/theblog/document.md',
      parent: '/sites/TheBlog/Shared Documents/theblog/',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve(editUrl.href, {
        id: 'document-id', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'document.md',
      editContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      editUrl,
      path: '/document',
      resourcePath: '/document.md',
      sourceLastModified: undefined,
      sourceLocation: 'onedrive:/drives/drive-id/items/document-id',
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
    });
  });

  it('resolves edit url of a folder with RootFolder query param', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/Forms/AllItems.aspx', {
      csf: '1',
      web: '1',
      e: '7tg6sK',
      cid: 'f8c5716b-a9b7-4dd0-a039-ed4f087d3248',
      RootFolder: '/sites/TheBlog/Shared Documents/theblog/folder',
      FolderCTID: '0x012000291CC2F215041D41ADE01F0A04AB94F2',
    });
    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve(`https://adobe.sharepoint.com${editUrl.searchParams.get('RootFolder')}`, {
        id: 'folder-id', mimeType: 'application/folder', folder: true,
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      editContentType: 'application/folder',
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
      editName: 'folder',
      editUrl,
      path: '/folder',
      resourcePath: '/folder',
      sourceLastModified: undefined,
      sourceLocation: 'onedrive:/drives/drive-id/items/folder-id',
      status: 200,
    });
  });

  it('returns error on for invalid edit url', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:w:/r/sites/TheBlog/_not_layouts/15/Doc.aspx', {
      sourcedoc: '{09BFA93A-78BC-49F6-B93D-990A0ED4D55C}',
      file: 'index.docx',
      action: 'default',
      mobileredirect: 'true',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user();

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      error: `Handler onedrive could not lookup ${editUrl}.`,
      status: 404,
    });
  });

  it('resolves web resource path for onedrive pdf (open-url)', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog/document.pdf', {
      CT: '1657805890022',
      OR: 'ItemsView',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .resolve(editUrl.href, {
        id: 'document-id', mimeType: 'application/pdf',
      })
      .resolve('')
      .getFolder('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      status: 200,
      editName: 'document.pdf',
      editContentType: 'application/pdf',
      editUrl,
      path: '/document.pdf',
      resourcePath: '/document.pdf',
      sourceLastModified: undefined,
      sourceLocation: 'onedrive:/drives/drive-id/items/document-id',
      editFolders: [
        {
          name: 'theblog',
          path: '/',
          url: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
        },
      ],
    });
  });

  it('returns error for a document on different sharepoint host', async () => {
    const editUrl = createURL('https://adobe.sharepoint.com/:w:/r/personal/tripod_adobe_com/_layouts/15/Doc.asp', {
      sourcedoc: '{09BFA93A-78BC-49F6-B93D-990A0ED4D55C}',
      file: 'page.docx',
      action: 'default',
      mobileredirect: 'true',
    });

    nock.onedrive(SITE_1D_CONFIG.content)
      .user()
      .login()
      .getSiteItem('personal/tripod_adobe_com', '09BFA93A-78BC-49F6-B93D-990A0ED4D55C', {
        webUrl: 'https://adobe-my.sharepoint.com/personal/tripod_adobe_com/page.docx',
      })
      .resolve('https://adobe-my.sharepoint.com/personal/tripod_adobe_com/page.docx', {
        webUrl: 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
      })
      .resolve('');

    const result = await edit2web(
      createContext(suffix, {
        attributes: { config: SITE_1D_CONFIG },
        env: ENV,
      }),
      createInfo(suffix),
      editUrl,
    );

    assert.deepStrictEqual(result, {
      error: `Handler onedrive could not lookup ${editUrl}.`,
      status: 404,
    });
  });
});
