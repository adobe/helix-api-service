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
import { Nock, SITE_CONFIG } from '../utils.js';

const CONTENT_BUS_ID = SITE_CONFIG.content.contentBusId;

describe('Status Handler Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  it('return 405 with method not allowed', async () => {
    const suffix = '/org/sites/site/status/document';

    const result = await main(new Request('https://api.aem.live/', {
      method: 'PUT',
    }), {
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
      links: {
        code: 'https://api.aem.live/org/repos/site/code/main/',
        live: 'https://api.aem.live/org/sites/site/live/',
        preview: 'https://api.aem.live/org/sites/site/preview/',
        status: 'https://api.aem.live/org/sites/site/status/',
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
      code: {
        status: 403,
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
    nock.code()
      .head('/folder/page')
      .reply(404);

    const result = await main(new Request('https://api.aem.live/?editUrl=auto'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        redirects: { preview: [], live: [] },
      },
    });

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
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
      links: {
        code: 'https://api.aem.live/org/repos/site/code/main/folder/page',
        live: 'https://api.aem.live/org/sites/site/live/folder/page',
        preview: 'https://api.aem.live/org/sites/site/preview/folder/page',
        status: 'https://api.aem.live/org/sites/site/status/folder/page',
      },
      live: {
        url: 'https://main--site--org.aem.live/folder/page',
        status: 200,
        contentBusId: `helix-content-bus/${SITE_CONFIG.content.contentBusId}/live/folder/page.md`,
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
        contentBusId: `helix-content-bus/${SITE_CONFIG.content.contentBusId}/preview/folder/page.md`,
        contentType: 'text/plain; charset=utf-8',
        lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
        sourceLocation: 'google:*',
        permissions: [
          'read',
          'write',
        ],
      },
      code: {
        codeBusId: 'helix-code-bus/owner/repo/main/folder/page',
        permissions: [
          'read',
          'write',
        ],
        sourceLocation: 'https://raw.githubusercontent.com/owner/repo/main/folder/page',
        status: 404,
      },
      resourcePath: '/folder/page.md',
      webPath: '/folder/page',
    });
  });

  it('calls `edit2web` when `editUrl` is not `auto`', async () => {
    const suffix = '/org/sites/site/status/';
    const editUrl = encodeURIComponent('https://docs.google.com/document/d/1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys/edit');

    nock.google(SITE_CONFIG.content)
      .user()
      .item('1ZJWJwL9szyTq6B-W0_Y7bFL1Tk1vyym4RyQ7AKXS7Ys', {
        mimeType: 'application/vnd.google-apps.document',
        name: 'index',
        parents: [SITE_CONFIG.content.source.id],
        modifiedTime: 'Tue, 15 Jun 2021 03:54:28 GMT',
      })
      .item(SITE_CONFIG.content.source.id, {
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
      .reply(404);

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
      links: {
        code: 'https://api.aem.live/org/repos/site/code/main/',
        live: 'https://api.aem.live/org/sites/site/live/',
        preview: 'https://api.aem.live/org/sites/site/preview/',
        status: 'https://api.aem.live/org/sites/site/status/',
      },
      live: {
        contentBusId: `helix-content-bus/${SITE_CONFIG.content.contentBusId}/live/index.md`,
        permissions: [
          'read',
          'write',
        ],
        status: 404,
        url: 'https://main--site--org.aem.live/',
      },
      preview: {
        contentBusId: `helix-content-bus/${SITE_CONFIG.content.contentBusId}/preview/index.md`,
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
      code: {
        permissions: [
          'read',
          'write',
        ],
        status: 400,
      },
      resourcePath: '/index.md',
      webPath: '/',
    });
  });

  it('reports the code bus status', async () => {
    const suffix = '/org/sites/site/status/scripts/scripts.js';

    nock.content()
      .head('/preview/scripts/scripts.js')
      .reply(404)
      .head('/live/scripts/scripts.js')
      .reply(404);

    nock.code()
      .head('/scripts/scripts.js')
      .reply(200, '', {
        'content-type': 'text/plain',
        'last-modified': 'Tue, 15 Jun 2021 07:54:28 GMT',
        'x-source-content-length': '45',
        'x-source-last-modified': 'Tue, 15 Jun 2021 04:54:28 GMT',

      });

    const result = await main(new Request('https://api.aem.live/'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        redirects: { preview: [], live: [] },
      },
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(
      await result.json(),
      {
        code: {
          codeBusId: 'helix-code-bus/owner/repo/main/scripts/scripts.js',
          permissions: [
            'read',
            'write',
          ],
          contentType: 'text/plain',
          lastModified: 'Tue, 15 Jun 2021 07:54:28 GMT',
          sourceLocation: 'https://raw.githubusercontent.com/owner/repo/main/scripts/scripts.js',
          status: 200,
        },
        edit: {},
        links: {
          code: 'https://api.aem.live/org/repos/site/code/main/scripts/scripts.js',
          live: 'https://api.aem.live/org/sites/site/live/scripts/scripts.js',
          preview: 'https://api.aem.live/org/sites/site/preview/scripts/scripts.js',
          status: 'https://api.aem.live/org/sites/site/status/scripts/scripts.js',
        },
        live: {
          contentBusId: `helix-content-bus/${CONTENT_BUS_ID}/live/scripts/scripts.js`,
          permissions: [
            'read',
            'write',
          ],
          status: 404,
          url: 'https://main--site--org.aem.live/scripts/scripts.js',
        },
        preview: {
          contentBusId: `helix-content-bus/${CONTENT_BUS_ID}/preview/scripts/scripts.js`,
          permissions: [
            'read',
            'write',
          ],
          status: 404,
          url: 'https://main--site--org.aem.page/scripts/scripts.js',
        },
        resourcePath: '/scripts/scripts.js',
        webPath: '/scripts/scripts.js',
      },
    );
  });

  it('reports the code bus status (branch)', async () => {
    const suffix = '/org/sites/site/status/scripts/scripts.js';

    nock.content()
      .head('/preview/scripts/scripts.js')
      .reply(404)
      .head('/live/scripts/scripts.js')
      .reply(404);

    nock.code('my-issue')
      .head('/scripts/scripts.js')
      .reply(200, '', {
        'content-type': 'text/plain',
        'last-modified': 'Tue, 15 Jun 2021 07:54:28 GMT',
        'x-source-content-length': '45',
        'x-source-last-modified': 'Tue, 15 Jun 2021 04:54:28 GMT',

      });

    const result = await main(new Request(new URL('https://api.aem.live/?branch=my.issue&ref=my-issue')), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        redirects: { preview: [], live: [] },
      },
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(
      await result.json(),
      {
        code: {
          codeBusId: 'helix-code-bus/owner/repo/my-issue/scripts/scripts.js',
          permissions: [
            'read',
            'write',
          ],
          contentType: 'text/plain',
          lastModified: 'Tue, 15 Jun 2021 07:54:28 GMT',
          sourceLocation: 'https://raw.githubusercontent.com/owner/repo/my.issue/scripts/scripts.js',
          status: 200,
        },
        edit: {},
        links: {
          code: 'https://api.aem.live/org/repos/site/code/my-issue/scripts/scripts.js?branch=my.issue',
          live: 'https://api.aem.live/org/sites/site/live/scripts/scripts.js',
          preview: 'https://api.aem.live/org/sites/site/preview/scripts/scripts.js',
          status: 'https://api.aem.live/org/sites/site/status/scripts/scripts.js',
        },
        live: {
          contentBusId: `helix-content-bus/${CONTENT_BUS_ID}/live/scripts/scripts.js`,
          permissions: [
            'read',
            'write',
          ],
          status: 404,
          url: 'https://my-issue--site--org.aem.live/scripts/scripts.js',
        },
        preview: {
          contentBusId: `helix-content-bus/${CONTENT_BUS_ID}/preview/scripts/scripts.js`,
          permissions: [
            'read',
            'write',
          ],
          status: 404,
          url: 'https://my-issue--site--org.aem.page/scripts/scripts.js',
        },
        resourcePath: '/scripts/scripts.js',
        webPath: '/scripts/scripts.js',
      },
    );
  });

  it('reports error in the code status', async () => {
    const suffix = '/org/sites/site/status/scripts/scripts.js';

    nock.content()
      .head('/preview/scripts/scripts.js')
      .reply(404)
      .head('/live/scripts/scripts.js')
      .reply(404);

    nock.code()
      .head('/scripts/scripts.js')
      .reply(400, '', {
        'x-error': 'kaputt',
      });

    const result = await main(new Request('https://api.aem.live/'), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        redirects: { preview: [], live: [] },
      },
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(
      await result.json(),
      {
        code: {
          codeBusId: 'helix-code-bus/owner/repo/main/scripts/scripts.js',
          sourceLocation: 'https://raw.githubusercontent.com/owner/repo/main/scripts/scripts.js',
          error: 'error while fetching: 400',
          permissions: [
            'read',
            'write',
          ],
          status: 502,
        },
        edit: {},
        links: {
          code: 'https://api.aem.live/org/repos/site/code/main/scripts/scripts.js',
          live: 'https://api.aem.live/org/sites/site/live/scripts/scripts.js',
          preview: 'https://api.aem.live/org/sites/site/preview/scripts/scripts.js',
          status: 'https://api.aem.live/org/sites/site/status/scripts/scripts.js',
        },
        live: {
          contentBusId: `helix-content-bus/${CONTENT_BUS_ID}/live/scripts/scripts.js`,
          permissions: [
            'read',
            'write',
          ],
          status: 404,
          url: 'https://main--site--org.aem.live/scripts/scripts.js',
        },
        preview: {
          contentBusId: `helix-content-bus/${CONTENT_BUS_ID}/preview/scripts/scripts.js`,
          permissions: [
            'read',
            'write',
          ],
          status: 404,
          url: 'https://main--site--org.aem.page/scripts/scripts.js',
        },
        resourcePath: '/scripts/scripts.js',
        webPath: '/scripts/scripts.js',
      },
    );
  });
});
