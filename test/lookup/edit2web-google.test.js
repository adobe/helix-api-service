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
import {
  Nock, SITE_CONFIG, createContext, createInfo,
} from '../utils.js';
import edit2web from '../../src/lookup/edit2web.js';

describe('edit2web Google Tests', () => {
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

  const suffix = '/owner/sites/repo/status/page';

  function setupTest() {
    const context = createContext(suffix);
    const info = createInfo(suffix);
    return { context, info };
  }

  it('returns error when document does not exist', async () => {
    const editUrl = 'https://drive.google.com/drive/documents/1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys';

    nock.google(SITE_CONFIG.content)
      .user()
      .item('1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys').reply(404);

    const { context, info } = setupTest();
    const result = await edit2web(context, info, editUrl);

    assert.deepStrictEqual(result, {
      error: 'Handler google could not lookup https://drive.google.com/drive/documents/1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys.',
      status: 404,
    });
  });

  it('returns error when document name contains illegal characters', async () => {
    const editUrl = 'gdrive:1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys';

    nock.google(SITE_CONFIG.content)
      .user()
      .item('1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys', {
        mimeType: 'application/vnd.google-apps.spreadsheet',
        name: '../page',
        parents: [SITE_CONFIG.content.source.id],
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      })
      .item(SITE_CONFIG.content.source.id, {
        mimeType: 'application/vnd.google-apps.folder',
        name: 'root',
        parents: [],
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      });

    const { context, info } = setupTest();
    const result = await edit2web(context, info, editUrl);

    assert.deepStrictEqual(result, {
      error: 'Illegal characters in document path',
      status: 404,
    });
  });

  it('adds `illegalPath` for documents', async () => {
    const editUrl = 'https://drive.google.com/drive/u/2/folders/1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys';

    nock.google(SITE_CONFIG.content)
      .user()
      .item('1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys', {
        mimeType: 'application/vnd.google-apps.document',
        name: 'page',
        parents: ['1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Yt'],
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      })
      .item('1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Yt', {
        mimeType: 'application/vnd.google-apps.folder',
        name: 'folder-',
        parents: [SITE_CONFIG.content.source.id],
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      })
      .item(SITE_CONFIG.content.source.id, {
        mimeType: 'application/vnd.google-apps.folder',
        name: 'root',
        parents: [],
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      });

    const { context, info } = setupTest();
    const result = await edit2web(context, info, editUrl);

    assert.deepStrictEqual(result, {
      editContentType: 'application/vnd.google-apps.document',
      editFolders: [
        {
          name: 'folder-',
          path: '/folder-',
          url: 'https://drive.google.com/drive/u/2/folders/1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Yt',
        },
        {
          name: '',
          path: '/',
          url: 'https://drive.google.com/drive/u/2/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
        },
      ],
      editName: 'page',
      editUrl,
      illegalPath: '/folder-/page',
      resourcePath: '/folder/page.md',
      sourceLastModified: 'Tue, 15 Jun 2021 03:54:28 GMT',
      sourceLocation: 'gdrive:1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys',
      status: 200,
      webPath: '/folder/page',
    });
  });

  it('adds `illegalPath` for folders', async () => {
    const editUrl = 'https://drive.google.com/drive/u/2/folders/1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys';

    nock.google(SITE_CONFIG.content)
      .user()
      .item('1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys', {
        mimeType: 'application/vnd.google-apps.folder',
        name: 'folder-',
        parents: [SITE_CONFIG.content.source.id],
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      })
      .item(SITE_CONFIG.content.source.id, {
        mimeType: 'application/vnd.google-apps.folder',
        name: 'root',
        parents: [],
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      });

    const { context, info } = setupTest();
    const result = await edit2web(context, info, editUrl);

    assert.deepStrictEqual(result, {
      editContentType: 'application/folder',
      editFolders: [
        {
          name: '',
          path: '/',
          url: 'https://drive.google.com/drive/u/2/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
        },
      ],
      editName: 'folder-',
      editUrl,
      illegalPath: '/folder-',
      resourcePath: '/folder',
      sourceLastModified: 'Tue, 15 Jun 2021 03:54:28 GMT',
      sourceLocation: 'gdrive:1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys',
      status: 200,
      webPath: '/folder',
    });
  });

  it('returns error when handler throws', async () => {
    const editUrl = 'gdrive:1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys';

    nock.google(SITE_CONFIG.content)
      .user()
      .item('1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys').reply(500);

    const { context, info } = setupTest();
    const result = await edit2web(context, info, editUrl);

    assert.deepStrictEqual(result, {
      error: 'Handler google could not lookup gdrive:1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys.',
      status: 404,
    });
  });

  it('passes information about throttling', async () => {
    const editUrl = 'gdrive:1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys';

    nock.google(SITE_CONFIG.content)
      .user()
      .item('1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys').reply(429);

    const { context, info } = setupTest();
    const result = await edit2web(context, info, editUrl);

    assert.deepStrictEqual(result, {
      error: 'Handler google could not lookup gdrive:1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys: (429) ',
      severity: 'warn',
      status: 503,
    });
  });
});
