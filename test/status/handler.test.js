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
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import {
  Nock, SITE_CONFIG, ORG_CONFIG,
} from '../utils.js';

describe('Status Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  it('return 405 with method not allowed', async () => {
    const suffix = '/org/sites/site/status/document';

    const result = await main(new Request('https://localhost/', { method: 'PUT' }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'method not allowed');
  });

  it('return 400 if `editUrl` is not auto and `webPath` is not `/`', async () => {
    const suffix = '/org/sites/site/status/document';

    const result = await main(new Request('https://api.aem.live/?editUrl=other'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 400);
  });

  it('return 400 if `editUrl` is not auto and `webPath` is not `/`', async () => {
    const suffix = '/org/sites/site/status/document';

    const result = await main(new Request('https://api.aem.live/?editUrl=other'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });
    assert.strictEqual(result.status, 400);
  });

  it('return 403 if `editUrl` is not auto and user lacks permissions', async () => {
    const suffix = '/org/sites/site/status/';

    const result = await main(new Request('https://api.aem.live/?editUrl=other'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default()
          .withAuthenticated(true)
          .withProfile({ defaultRole: 'media_author' }),
      },
    });
    assert.strictEqual(result.status, 403);
  });

  it('sets status to `403` if `editUrl` is `auto` and user lacks permissions', async () => {
    const suffix = '/org/sites/site/status/';

    const result = await main(new Request('https://api.aem.live/?editUrl=auto'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default()
          .withAuthenticated(true)
          .withProfile({ defaultRole: 'media_author' }),
      },
    });

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      edit: {
        status: 403,
      },
      live: {
        error: 'forbidden',
        status: 403,
        url: 'https://main--site--org.aem.live/',
      },
      preview: {
        error: 'forbidden',
        status: 403,
        url: 'https://main--site--org.aem.page/',
      },
      profile: {
        defaultRole: 'media_author',
      },
      resourcePath: '/index.md',
      webPath: '/',
    });
  });

  it('calls `web2edit` when `editUrl` is `auto`', async () => {
    const suffix = '/org/sites/site/status/folder/page';

    nock.google(SITE_CONFIG.content)
      .user()
      .folders([{
        mimeType: 'application/vnd.google-apps.folder',
        name: 'folder',
        id: '1BHM3lyqi0bEeaBZho8UD328oFsmsisyJ',
      }])
      .documents([{
        mimeType: 'application/vnd.google-apps.document',
        name: 'page',
        id: '1LSIpJMKoYeVn8-o4c2okZ6x0EwdGKtgOEkaxbnM8nZ4',
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      }], '1BHM3lyqi0bEeaBZho8UD328oFsmsisyJ');

    // getContentBusInfo (preview/live)
    nock.content()
      .head('/preview/folder/page.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
      .head('/live/folder/page.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const result = await main(new Request('https://api.aem.live/?editUrl=auto'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        redirects: { preview: [], live: [] },
      },
    });

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      webPath: '/folder/page',
      resourcePath: '/folder/page.md',
      live: {
        url: 'https://main--site--org.aem.live/folder/page',
        status: 200,
        contentBusId: 'helix-content-bus/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/live/folder/page.md',
        contentType: 'text/plain; charset=utf-8',
        lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
        sourceLocation: 'google:*',
        permissions: [
          'read',
          'write',
        ],
      },
      preview: {
        url: 'https://main--site--org.aem.page/folder/page',
        status: 200,
        contentBusId: 'helix-content-bus/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/folder/page.md',
        contentType: 'text/plain; charset=utf-8',
        lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
        sourceLocation: 'google:*',
        permissions: [
          'read',
          'write',
        ],
      },
      edit: {
        url: 'https://docs.google.com/document/d/1LSIpJMKoYeVn8-o4c2okZ6x0EwdGKtgOEkaxbnM8nZ4/edit',
        name: 'page',
        contentType: 'application/vnd.google-apps.document',
        folders: [
          {
            name: 'folder',
            url: 'https://drive.google.com/drive/u/0/folders/1BHM3lyqi0bEeaBZho8UD328oFsmsisyJ',
            path: '/folder',
          },
          {
            name: '',
            url: 'https://drive.google.com/drive/u/0/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
            path: '/',
          },
        ],
        lastModified: 'Tue, 15 Jun 2021 03:54:28 GMT',
        sourceLocation: 'gdrive:1LSIpJMKoYeVn8-o4c2okZ6x0EwdGKtgOEkaxbnM8nZ4',
        status: 200,
      },
    });
  });

  it('calls `web2edit` when `editUrl` is not `auto`', async () => {
    const suffix = '/org/sites/site/status/';
    const editUrl = 'https://docs.google.com/document/d/1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys/edit';

    nock.google(SITE_CONFIG.content)
      .user()
      .file('1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys', {
        mimeType: 'application/vnd.google-apps.document',
        name: 'index',
        parents: [SITE_CONFIG.content.source.id],
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      })
      .file(SITE_CONFIG.content.source.id, {
        mimeType: 'application/vnd.google-apps.folder',
        name: 'root',
        parents: [],
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      });

    // getContentBusInfo (preview/live)
    nock.content()
      .head('/preview/index.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' })
      .head('/live/index.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const result = await main(new Request(`https://api.aem.live/?editUrl=${editUrl}`), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        redirects: { preview: [], live: [] },
      },
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      edit: {
        contentType: 'application/vnd.google-apps.document',
        folders: [
          {
            name: '',
            path: '/',
            url: 'https://drive.google.com/drive/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
          },
        ],
        lastModified: 'Tue, 15 Jun 2021 03:54:28 GMT',
        name: 'index',
        sourceLocation: 'gdrive:1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys',
        status: 200,
        url: 'https://docs.google.com/document/d/1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys/edit',
      },
      live: {
        contentBusId: 'helix-content-bus/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/live/index.md',
        contentType: 'text/plain; charset=utf-8',
        lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
        permissions: [
          'read',
          'write',
        ],
        sourceLocation: 'google:*',
        status: 200,
        url: 'https://main--site--org.aem.live/',
      },
      preview: {
        contentBusId: 'helix-content-bus/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/index.md',
        contentType: 'text/plain; charset=utf-8',
        lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
        permissions: [
          'read',
          'write',
        ],
        sourceLocation: 'google:*',
        status: 200,
        url: 'https://main--site--org.aem.page/',
      },
      resourcePath: '/index.md',
      webPath: '/',
    });
  });
});
