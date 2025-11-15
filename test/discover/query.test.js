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
import path from 'path';
import { AcquireMethod } from '@adobe/helix-onedrive-support';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

describe('Discover query tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(url, {
    authInfo = new AuthInfo().withRole('index').withAuthenticated(true),
    env,
  } = {}) {
    const suffix = '/discover';
    const query = new URLSearchParams(Object.entries({ url }).filter(([, v]) => !!v));

    const request = new Request(`https://api.aem.live${suffix}?${query}`);

    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo,
      },
      env: {
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'aws-access-key',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        CLOUDFLARE_ACCOUNT_ID: 'cloudflare-account',
        CLOUDFLARE_R2_ACCESS_KEY_ID: 'cloudflare-access-key',
        CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'cloudflare-secret',
        AZURE_HELIX_SERVICE_CLIENT_ID: 'client-id',
        AZURE_HELIX_SERVICE_CLIENT_SECRET: 'client-secret',
        AZURE_HELIX_SERVICE_ACQUIRE_METHOD: AcquireMethod.BY_CLIENT_CREDENTIAL,
        HLX_CONTENT_SOURCE_LOCK: JSON.stringify({ 'adobe.sharepoint.com': ['adobe/*'] }),
        ...env,
      },
    };
    return { request, context };
  }

  it('returns 400 when no URL is specified', async () => {
    const { request, context } = setupTest();
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'discover requires a `url` parameter',
    });
  });

  it('returns 400 when a malformed URL is passed', async () => {
    const { request, context } = setupTest('www.aem.live');
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'URL is malformed: www.aem.live: Invalid URL',
    });
  });

  it('returns 404 when no inventory is found', async () => {
    nock.inventory()
      .reply(404);

    const { request, context } = setupTest('https://www.aem.live');
    const response = await main(request, context);
    assert.strictEqual(response.status, 404);
  });

  it('returns empty result for known sharepoint without any entry', async () => {
    const url = 'https://other.sharepoint.com/:w:/r/sites/subsites/_layouts/15/Doc.aspx?sourcedoc=%7BBD3692CF-8BF0-4730-9360-A47F52E124B2%7D&file=index.docx&action=default&mobileredirect=true';

    nock.onedrive(SITE_CONFIG.content)
      .user('default');

    nock.inventory()
      .reply(200, {
        entries: [{}],
        hostTypes: {
          'other.sharepoint.com': 'sharepoint',
        },
      });

    const { request, context } = setupTest(url);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'application/json',
      vary: 'Accept-Encoding',
    });
    const actual = await response.json();
    assert.deepStrictEqual(actual, []);
  });

  it('returns empty result for bad sharepoint path name', async () => {
    const url = 'https://other.sharepoint.com//?startedResponseCatch=true#startedResponseCatch=true&view=0';

    nock.onedrive(SITE_CONFIG.content)
      .user('default');

    nock.inventory()
      .reply(200, {
        entries: [{}],
        hostTypes: {
          'other.sharepoint.com': 'sharepoint',
        },
      });

    const { request, context } = setupTest(url);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), []);
  });

  it('returns result for known sharepoint that only matches host name', async () => {
    const url = 'https://other.sharepoint.com/:w:/r/sites/subsites/_layouts/15/Doc.aspx?sourcedoc=%7BBD3692CF-8BF0-4730-9360-A47F52E124B2%7D&file=index.docx&action=default&mobileredirect=true';

    nock.onedrive(SITE_CONFIG.content)
      .login(undefined, 'other')
      .user('default');

    nock.inventory()
      .reply(200, {
        entries: [{
          sharepointSite: 'https://other.sharepoint.com/',
          codeBusId: 'owner/repo',
        }],
        hostTypes: {
          'other.sharepoint.com': 'sharepoint',
        },
      });
    nock('https://graph.microsoft.com')
      .get('/v1.0/sites/other.sharepoint.com:/sites/subsites:/items/BD3692CF-8BF0-4730-9360-A47F52E124B2')
      .reply(200, {
        webUrl: 'https://other.sharepoint.com/sites/mysite/Shared%20Documents/index.docx',
      });

    const { request, context } = setupTest(url);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), [{
      codeBusId: 'owner/repo',
      githubUrl: 'https://github.com/owner/repo',
      originalRepository: false,
      originalSite: false,
    }]);
  });

  it('returns all entries for url=*', async () => {
    const url = '*';

    nock.inventory()
      .replyWithFile(200, path.resolve(__testdir, 'discover', 'fixtures', 'inventory-small.json'));

    const { request, context } = setupTest(url, {
      authInfo: AuthInfo.Default().withPermissions(['discover:list']),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), [{
      originalRepository: true,
      org: 'company',
      site: 'test',
      originalSite: true,
      owner: 'company',
      repo: 'test',
    },
    {
      originalRepository: true,
      org: 'company',
      site: 'testother',
      originalSite: true,
      owner: 'company',
      repo: 'testother',
    }]);
  });

  it('returns only original repository for boilerplate', async () => {
    const url = 'https://drive.google.com/drive/u/0/folders/1gpVvMWaxoXxVvtq0LLbbMyF6_H_IB6th';

    nock.inventory()
      .replyWithFile(200, path.resolve(__testdir, 'discover', 'fixtures', 'inventory-boilerplate.json'));

    nock.google(SITE_CONFIG.content)
      .user('default');

    nock('https://www.googleapis.com')
      .get('/drive/v3/files/1gpVvMWaxoXxVvtq0LLbbMyF6_H_IB6th')
      .query(true)
      .reply(200, {
        name: 'documents',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [
          '1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
        ],
        modifiedTime: '2022-04-12T08:38:14.913Z',
      })
      .get('/drive/v3/files/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1')
      .query(true)
      .reply(200, {
        name: 'aem-boilerplate',
        mimeType: 'application/vnd.google-apps.folder',
        modifiedTime: '2022-04-12T08:30:18.845Z',
      });

    const { request, context } = setupTest(url, {
      authInfo: new AuthInfo().withRole('basic_publish'),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), [{
      org: 'adobe',
      site: 'aem-boilerplate',
      owner: 'adobe',
      repo: 'aem-boilerplate',
      originalRepository: true,
      originalSite: true,
    }]);
  });

  it('returns empty result for bad pathname', async () => {
    const url = 'https://other.sharepoint.com//';

    nock.onedrive(SITE_CONFIG.content)
      .user('default');

    nock.inventory()
      .reply(200, {
        entries: [{
          sharepointSite: 'https://other.sharepoint.com/',
        }],
        hostTypes: {
          'other.sharepoint.com': 'sharepoint',
        },
      });

    const { request, context } = setupTest(url);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), []);
  });

  it('list needs discover:list permission', async () => {
    const { request, context } = setupTest('*');
    const response = await main(request, context);

    assert.strictEqual(response.status, 403);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'not authorized',
    });
  });

  describe('with large inventory', () => {
    beforeEach(async () => {
      nock.inventory()
        .replyWithFile(200, path.resolve(__testdir, 'discover', 'fixtures', 'inventory.json'));
    });

    it('returns 404 correct entry for unsupported url', async () => {
      const url = 'https://site.company.com/';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'no matcher found for https://site.company.com/',
        vary: 'Accept-Encoding',
      });
    });

    it('returns only entries that match site (with Defender DNS suffix)', async () => {
      const url = 'https://company.sharepoint.com.rs-mcas.ms/sites/subsites/Shared%20Documents/test/mydocument.docx';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          contentBusId: '9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6e',
          contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/test',
          codeBusId: 'company/test',
          githubUrl: 'https://github.com/company/test',
          originalRepository: true,
          originalSite: true,
          owner: 'company',
          repo: 'test',
          org: 'company',
          site: 'test',
          routes: [],
          url: 'https://test.company.com',
        },
      ]);
    });

    it('returns only entries that match site (not a prefix)', async () => {
      const url = 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/test/mydocument.docx';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          codeBusId: 'company/test',
          contentBusId: '9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6e',
          contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/test',
          githubUrl: 'https://github.com/company/test',
          originalRepository: true,
          originalSite: true,
          owner: 'company',
          repo: 'test',
          org: 'company',
          site: 'test',
          routes: [],
          url: 'https://test.company.com',
        },
      ]);
    });

    it('returns sharepoint entry when part of the URL has different case', async () => {
      const url = 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/Test/mydocument.docx';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          codeBusId: 'company/test',
          contentBusId: '9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6e',
          contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/test',
          githubUrl: 'https://github.com/company/test',
          originalRepository: true,
          originalSite: true,
          owner: 'company',
          repo: 'test',
          org: 'company',
          site: 'test',
          routes: [],
          url: 'https://test.company.com',
        },
      ]);
    });

    it('returns entries that match site with trailing slash', async () => {
      const url = 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/slash/mydocument.docx';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          codeBusId: 'company/slash',
          contentBusId: '9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6f',
          contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/slash/',
          githubUrl: 'https://github.com/company/slash',
          originalRepository: true,
          originalSite: true,
          owner: 'company',
          repo: 'slash',
          org: 'company',
          site: 'slash',
          routes: [],
          url: 'https://slash.company.com',
        },
      ]);
    });

    it('returns correct entry for github', async () => {
      const url = 'https://github.com/company/site/blob/main/fstab.yaml';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [{
        codeBusId: 'company/site',
        contentBusId: '9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d',
        contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/site',
        githubUrl: 'https://github.com/company/site',
        originalRepository: true,
        originalSite: true,
        owner: 'company',
        repo: 'site',
        org: 'company',
        site: 'site',
        routes: [
          '/page',
        ],
        url: 'https://site.company.com',
      }]);
    });

    it('returns correct entry for google document', async () => {
      const url = 'https://docs.google.com/spreadsheets/d/1_NLihZ4EQFT6YsKVgWetecS8vZzoywS35HRGF5z1oQc/edit#gid=0';

      nock.google(SITE_CONFIG.content)
        .user('default');

      nock('https://www.googleapis.com')
        .get('/drive/v3/files/1_NLihZ4EQFT6YsKVgWetecS8vZzoywS35HRGF5z1oQc')
        .query(true)
        .reply(200, {
          name: 'spreadsheet',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [
            '1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
          ],
          modifiedTime: '2020-11-12T06:33:05.921Z',
        })
        .get('/drive/v3/files/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1')
        .query(true)
        .reply(200, {
          name: 'helix-test-content-gdrive',
          mimeType: 'application/vnd.google-apps.folder',
          modifiedTime: '2022-07-08T14:09:39.871Z',
        });

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [{
        codeBusId: 'company/subsiteB',
        contentBusId: '76c485f687b82bface8b7f4e9e7a47f146eab10b3c6e0ee21418f5112bb',
        contentSourceUrl: 'https://drive.google.com/drive/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
        githubUrl: 'https://github.com/company/subsiteB',
        originalRepository: true,
        originalSite: true,
        owner: 'company',
        repo: 'subsiteB',
        org: 'company',
        site: 'subsiteB',
        routes: [
          '**/B/**',
        ],
        url: 'https://www.company.com',
      }]);
    });

    it('returns empty result for google folder if root id does not match', async () => {
      const url = 'https://drive.google.com/drive/u/0/folders/1gpVvMWaxoXxVvtq0LLbbMyF6_H_IB6th';

      nock.google(SITE_CONFIG.content)
        .user('default');

      nock('https://www.googleapis.com')
        .get('/drive/v3/files/1gpVvMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .query(true)
        .reply(200, {
          name: 'documents',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [
            '1N2zij7EMeS95cIFiRuxfjY0OxllX8my2',
          ],
          modifiedTime: '2022-04-12T08:38:14.913Z',
        })
        .get('/drive/v3/files/1N2zij7EMeS95cIFiRuxfjY0OxllX8my2')
        .query(true)
        .reply(200, {
          name: 'subsiteB',
          mimeType: 'application/vnd.google-apps.folder',
          modifiedTime: '2022-04-12T08:30:18.845Z',
        });

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), []);
    });

    it('returns correct entry for google folder', async () => {
      const url = 'https://drive.google.com/drive/u/0/folders/1gpVvMWaxoXxVvtq0LLbbMyF6_H_IB6th';

      nock.google(SITE_CONFIG.content)
        .user('default');

      nock('https://www.googleapis.com')
        .get('/drive/v3/files/1gpVvMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .query(true)
        .reply(200, {
          name: 'documents',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [
            '1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
          ],
          modifiedTime: '2022-04-12T08:38:14.913Z',
        })
        .get('/drive/v3/files/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1')
        .query(true)
        .reply(200, {
          name: 'subsiteB',
          mimeType: 'application/vnd.google-apps.folder',
          modifiedTime: '2022-04-12T08:30:18.845Z',
        });

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          codeBusId: 'company/subsiteB',
          contentBusId: '76c485f687b82bface8b7f4e9e7a47f146eab10b3c6e0ee21418f5112bb',
          contentSourceUrl: 'https://drive.google.com/drive/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
          githubUrl: 'https://github.com/company/subsiteB',
          originalRepository: true,
          originalSite: true,
          org: 'company',
          site: 'subsiteB',
          owner: 'company',
          repo: 'subsiteB',
          routes: [
            '**/B/**',
          ],
          url: 'https://www.company.com',
        },
      ]);
    });

    it('returns correct entry for google folder (custom user)', async () => {
      const url = 'https://drive.google.com/drive/u/0/folders/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th';

      nock.google(SITE_CONFIG.content)
        .user('default')
        .user('96c485f687b82bface8b7f4e9e7a47f146eab10b3c6e0ee21418f5112bb');

      nock('https://www.googleapis.com')
        .get('/drive/v3/files/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .query(true)
        .reply(404)
        .get('/drive/v3/files/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .query(true)
        .reply(200, {
          name: 'documents',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [
            'abczij7EMeS95cIFiRuxfjY0OxllX8my1',
          ],
          modifiedTime: '2022-04-12T08:38:14.913Z',
        })
        .get('/drive/v3/files/abczij7EMeS95cIFiRuxfjY0OxllX8my1')
        .query(true)
        .reply(200, {
          name: 'subsiteBC',
          mimeType: 'application/vnd.google-apps.folder',
          modifiedTime: '2022-04-12T08:30:18.845Z',
        });

      const { request, context } = setupTest(url, {
        env: {
          HLX_CUSTOM_GOOGLE_USERS: 'company/*',
        },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          codeBusId: 'company/subsiteC',
          contentBusId: '96c485f687b82bface8b7f4e9e7a47f146eab10b3c6e0ee21418f5112bb',
          contentSourceUrl: 'https://drive.google.com/drive/folders/abczij7EMeS95cIFiRuxfjY0OxllX8my1',
          githubUrl: 'https://github.com/company/subsiteC',
          originalRepository: true,
          originalSite: true,
          org: 'company',
          site: 'subsiteC',
          owner: 'company',
          repo: 'subsiteC',
          url: 'https://www.company.com',
          customUser: true,
        },
      ]);
    });

    it('returns empty result for google folder (custom user) if not configured', async () => {
      const url = 'https://drive.google.com/drive/u/0/folders/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th';

      nock.google(SITE_CONFIG.content)
        .user('default');

      nock('https://www.googleapis.com')
        .get('/drive/v3/files/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .query(true)
        .reply(404);

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), []);
    });

    it('returns empty result for google folder (custom user) if root id does not match', async () => {
      const url = 'https://drive.google.com/drive/u/0/folders/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th';

      nock.google(SITE_CONFIG.content)
        .user('default')
        .user('96c485f687b82bface8b7f4e9e7a47f146eab10b3c6e0ee21418f5112bb');

      nock('https://www.googleapis.com')
        .get('/drive/v3/files/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .query(true)
        .reply(404)
        .get('/drive/v3/files/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .query(true)
        .reply(200, {
          name: 'documents',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [
            'abczij7EMeS95cIFiRuxfjY0OxllX8my2',
          ],
          modifiedTime: '2022-04-12T08:38:14.913Z',
        })
        .get('/drive/v3/files/abczij7EMeS95cIFiRuxfjY0OxllX8my2')
        .query(true)
        .reply(200, {
          name: 'subsiteBC',
          mimeType: 'application/vnd.google-apps.folder',
          modifiedTime: '2022-04-12T08:30:18.845Z',
        });

      const { request, context } = setupTest(url, {
        env: {
          HLX_CUSTOM_GOOGLE_USERS: 'company/*',
        },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), []);
    });

    it('catches error for google folder (custom user)', async () => {
      const url = 'https://drive.google.com/drive/u/0/folders/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th';

      nock.google(SITE_CONFIG.content)
        .user('default')
        .user('96c485f687b82bface8b7f4e9e7a47f146eab10b3c6e0ee21418f5112bb');

      nock('https://www.googleapis.com')
        .get('/drive/v3/files/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .query(true)
        .reply(404)
        .get('/drive/v3/files/abcdeMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .query(true)
        .reply(400, {
          error: {
            errors: [{
              message: 'Invalid grant',
              domain: 'global',
              reason: 'invalidGrant',
            }],
          },
        });

      const { request, context } = setupTest(url, {
        env: {
          HLX_CUSTOM_GOOGLE_USERS: 'company/*',
        },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), []);
    });

    it('returns correct entry for google root folder', async () => {
      const url = 'https://drive.google.com/drive/u/0/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          codeBusId: 'company/subsiteB',
          contentBusId: '76c485f687b82bface8b7f4e9e7a47f146eab10b3c6e0ee21418f5112bb',
          contentSourceUrl: 'https://drive.google.com/drive/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
          githubUrl: 'https://github.com/company/subsiteB',
          originalRepository: true,
          originalSite: true,
          org: 'company',
          site: 'subsiteB',
          owner: 'company',
          repo: 'subsiteB',
          routes: [
            '**/B/**',
          ],
          url: 'https://www.company.com',
        },
      ]);
    });

    it('returns no results when google item id is not found', async () => {
      const url = 'https://drive.google.com/drive/u/0/folders/1gpVvMWaxoXxVvtq0LLbbMyF6_H_IB6th';

      nock.google(SITE_CONFIG.content)
        .user('default')
        .user('96c485f687b82bface8b7f4e9e7a47f146eab10b3c6e0ee21418f5112bb');

      nock('https://www.googleapis.com')
        .get('/drive/v3/files/1gpVvMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .twice()
        .query(true)
        .reply(404);

      const { request, context } = setupTest(url, {
        env: {
          HLX_CUSTOM_GOOGLE_USERS: 'company/subsiteC',
        },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), []);
    });

    it('returns empty result if get items returns error', async () => {
      const url = 'https://drive.google.com/drive/u/0/folders/1gpVvMWaxoXxVvtq0LLbbMyF6_H_IB6th';

      nock.google(SITE_CONFIG.content)
        .user('default');

      nock('https://www.googleapis.com')
        .get('/drive/v3/files/1gpVvMWaxoXxVvtq0LLbbMyF6_H_IB6th')
        .query(true)
        .reply(400, {
          error: {
            errors: [{
              message: 'Invalid field selection name',
              domain: 'global',
              reason: 'invalidParameter',
              location: 'fields',
              locationType: 'parameter',
            }],
          },
        });

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), []);
    });

    it('returns empty result for gdrive URL with no id', async () => {
      const url = 'https://docs.google.com/forms/u/0/?tgif=d';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), []);
    });

    it('returns correct entry for sharepoint folder with id parameter', async () => {
      const url = 'https://company.sharepoint.com/:f:/r/sites/subsites/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          codeBusId: 'company/subsiteA',
          contentBusId: '4732a86215d664eacc536e38d2e96d7235485443c83764ebd2dd7c3156c',
          contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA',
          githubUrl: 'https://github.com/company/subsiteA',
          originalRepository: true,
          originalSite: true,
          org: 'company',
          site: 'subsiteA',
          owner: 'company',
          repo: 'subsiteA',
          routes: [
            '**/A/**',
          ],
          url: 'https://www.company.com',
        },
      ]);
    });

    it('returns correct entry for sharepoint folder with AllItems1 and id parameter', async () => {
      const url = 'https://company.sharepoint.com/:f:/r/sites/subsites/Shared%20Documents/Forms/AllItems1.aspx?id=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          codeBusId: 'company/subsiteA',
          contentBusId: '4732a86215d664eacc536e38d2e96d7235485443c83764ebd2dd7c3156c',
          contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA',
          githubUrl: 'https://github.com/company/subsiteA',
          originalRepository: true,
          originalSite: true,
          org: 'company',
          site: 'subsiteA',
          owner: 'company',
          repo: 'subsiteA',
          routes: [
            '**/A/**',
          ],
          url: 'https://www.company.com',
        },
      ]);
    });

    it('returns correct entry for sharepoint folder with RootFolder parameter', async () => {
      const url = 'https://company.sharepoint.com/:f:/r/sites/subsites/Shared%20Documents/Forms/AllItems.aspx?RootFolder=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          codeBusId: 'company/subsiteA',
          contentBusId: '4732a86215d664eacc536e38d2e96d7235485443c83764ebd2dd7c3156c',
          contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA',
          githubUrl: 'https://github.com/company/subsiteA',
          originalRepository: true,
          originalSite: true,
          org: 'company',
          site: 'subsiteA',
          owner: 'company',
          repo: 'subsiteA',
          routes: [
            '**/A/**',
          ],
          url: 'https://www.company.com',
        },
      ]);
    });

    it('returns no result for sharepoint folder that has neither id nor RootFolder parameter', async () => {
      const url = 'https://company.sharepoint.com/:f:/r/sites/subsites/Shared%20Documents/Forms/AllItems.aspx?FolderCTID=0x0123456789ABCDEF0123456789ABCDEF012345';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), []);
    });

    it('returns correct entry for sharepoint media with stream and id parameter', async () => {
      const url = 'https://company.sharepoint.com/sites/subsites/_layouts/15/stream.aspx?id=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA%2Ftest.map4';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [
        {
          codeBusId: 'company/subsiteA',
          contentBusId: '4732a86215d664eacc536e38d2e96d7235485443c83764ebd2dd7c3156c',
          contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA',
          githubUrl: 'https://github.com/company/subsiteA',
          originalRepository: true,
          originalSite: true,
          org: 'company',
          site: 'subsiteA',
          owner: 'company',
          repo: 'subsiteA',
          routes: [
            '**/A/**',
          ],
          url: 'https://www.company.com',
        },
      ]);
    });

    it('returns no result for sharepoint media that has no id parameter', async () => {
      const url = 'https://company.sharepoint.com/sites/subsites/_layouts/15/stream.aspx';

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), []);
    });

    it('returns correct entry for sharepoint document', async () => {
      const url = 'https://company.sharepoint.com/:w:/r/sites/subsites/_layouts/15/Doc.aspx?sourcedoc=%7BBD3692CF-8BF0-4730-9360-A47F52E124B2%7D&file=index.docx&action=default&mobileredirect=true';

      nock.onedrive(SITE_CONFIG.content)
        .login(undefined, 'company')
        .user('default');

      nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
        .head('/9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d/.helix-auth/auth-onedrive-content.json')
        .reply(404);
      nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
        .head('/company/.helix-auth/auth-onedrive-content.json')
        .reply(404);

      nock('https://graph.microsoft.com')
        .get('/v1.0/sites/company.sharepoint.com:/sites/subsites:/items/BD3692CF-8BF0-4730-9360-A47F52E124B2')
        .reply(200, {
          webUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/subsiteA/index.docx',
        });

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [{
        codeBusId: 'company/subsiteA',
        contentBusId: '4732a86215d664eacc536e38d2e96d7235485443c83764ebd2dd7c3156c',
        contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA',
        githubUrl: 'https://github.com/company/subsiteA',
        originalRepository: true,
        originalSite: true,
        org: 'company',
        site: 'subsiteA',
        owner: 'company',
        repo: 'subsiteA',
        routes: [
          '**/A/**',
        ],
        url: 'https://www.company.com',
      }]);
    });

    it('returns correct entry for sharepoint document that does not match', async () => {
      const url = 'https://adobe-my.sharepoint.com/personal/foo_adobe_com/_layouts/15/Doc.aspx?sourcedoc=%7BBD3692CF-8BF0-4730-9360-A47F52E124B2%7D&file=index.docx&action=default&mobileredirect=true';

      nock.onedrive(SITE_CONFIG.content)
        .login(undefined)
        .user('default');

      nock('https://graph.microsoft.com')
        .get('/v1.0/sites/adobe-my.sharepoint.com:/personal/foo_adobe_com:/items/BD3692CF-8BF0-4730-9360-A47F52E124B2')
        .reply(200, {
          webUrl: 'https://adobe-my.sharepoint.com/personal/foo_adobe_com/Shared%20Documents/subsiteA/index.docx',
        });

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), []);
    });

    it('returns simple sharepoint lookup for other tenant', async () => {
      const url = 'https://tenant.sharepoint.com/sites/site/Shared%20Documents/_layouts/15/Doc.aspx?sourcedoc=%7B8663A8B6-5662-42D7-A244-CB4E7BD38A40%7D';

      nock.onedrive(SITE_CONFIG.content)
        .login(undefined, 'tenant')
        .user('default');

      nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
        .head('/76c485f687b82bface8b7f4e9e7a47f146eab10b3c6e0ee21418f5112bc/.helix-auth/auth-onedrive-content.json')
        .reply(404);
      nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
        .head('/tenant/.helix-auth/auth-onedrive-content.json')
        .reply(404);

      nock('https://graph.microsoft.com')
        .get('/v1.0/sites/tenant.sharepoint.com:/sites/site/Shared%20Documents:/items/8663A8B6-5662-42D7-A244-CB4E7BD38A40')
        .reply(400, {
          error: {
            code: 'invalidRequest',
            message: 'Invalid hostname for this tenancy',
          },
        });

      const { request, context } = setupTest(url);
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [{
        codeBusId: 'tenant/site',
        contentBusId: '76c485f687b82bface8b7f4e9e7a47f146eab10b3c6e0ee21418f5112bc',
        contentSourceUrl: 'https://tenant.sharepoint.com/:f:/r/sites/site/Shared%20Documents/website/root?csf=1&web=1&e=rQbhRS',
        githubUrl: 'https://github.com/tenant/site',
        originalRepository: true,
        originalSite: true,
        org: 'tenant',
        site: 'site',
        owner: 'tenant',
        repo: 'site',
        routes: [],
        url: 'https://site.tenant.com',
      }]);
    });

    it('returns fewer properties for anonymous user', async () => {
      const url = 'https://company.sharepoint.com/:w:/r/sites/subsites/_layouts/15/Doc.aspx?sourcedoc=%7BBD3692CF-8BF0-4730-9360-A47F52E124B2%7D&file=index.docx&action=default&mobileredirect=true';

      nock.onedrive(SITE_CONFIG.content)
        .user('default')
        .login(undefined, 'company');

      nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
        .head('/9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d/.helix-auth/auth-onedrive-content.json')
        .reply(404);
      nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
        .head('/company/.helix-auth/auth-onedrive-content.json')
        .reply(404);

      nock('https://graph.microsoft.com')
        .get('/v1.0/sites/company.sharepoint.com:/sites/subsites:/items/BD3692CF-8BF0-4730-9360-A47F52E124B2')
        .reply(200, {
          webUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/subsiteA/index.docx',
        });

      const { request, context } = setupTest(url, {
        authInfo: new AuthInfo().withRole('basic_publish'),
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), [{
        org: 'company',
        site: 'subsiteA',
        originalRepository: true,
        originalSite: true,
        owner: 'company',
        repo: 'subsiteA',
      }]);
    });
  });
});
