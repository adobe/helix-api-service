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
import xml2js from 'xml2js';
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

describe('Discover reindex tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('../../src/discover/inventory.js').Inventory} */
  let inventory;

  beforeEach(() => {
    nock = new Nock().env();

    nock.content('default')
      .putObject('/inventory-v2.json')
      .optionally(true)
      .reply((_, body) => {
        inventory = body;
        return [201];
      });
  });

  afterEach(() => {
    inventory = null;

    nock.done();
  });

  function setupTest(org, site, {
    authInfo = new AuthInfo().withRole('index'),
    claimOriginalSite,
    env,
  } = {}) {
    const suffix = '/discover';
    const query = new URLSearchParams(Object.entries({
      org, site, claimOriginalSite,
    }).filter(([, v]) => !!v));

    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      method: 'POST',
    });
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
        HELIX_STORAGE_DISABLE_R2: 'true',
        ...env,
      },
    };
    return { request, context };
  }

  it('returns 400 when `org` and `site` are not specified', async () => {
    const { request, context } = setupTest('org', null);
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'reindex requires `org` or `org` and `site`',
    });
  });

  it('returns 401 for anonymous role', async () => {
    const { request, context } = setupTest('*', null, {
      authInfo: new AuthInfo().withRole('anonymous'),
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 401);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'not authenticated',
    });
  });

  it('reindex all projects returns 200 when it succeeds', async () => {
    nock('https://helix-config-bus.s3.us-east-1.amazonaws.com')
      .get('/?delimiter=%2F&list-type=2&prefix=orgs%2F')
      .reply(() => [200, new xml2js.Builder().buildObject({
        ListBucketResult: {
          CommonPrefixes: [{
            Prefix: 'orgs/org1/',
          }, {
            Prefix: 'orgs/org2/',
          }],
        },
      })])
      .get('/?delimiter=%2F&list-type=2&prefix=orgs/org1/sites/')
      .reply(() => [200, new xml2js.Builder().buildObject({
        ListBucketResult: {
          KeyCount: 1,
          Contents: [
            {
              Key: 'orgs/org1/sites/site1.json',
              LastModified: '2023-10-06T08:05:00.000Z',
            },
          ],
        },
      })])
      .get('/?delimiter=%2F&list-type=2&prefix=orgs/org2/sites/')
      .reply(() => [200, new xml2js.Builder().buildObject({
        ListBucketResult: {
          KeyCount: 1,
          Contents: [
            {
              Key: 'orgs/org2/sites/site2.json',
              LastModified: '2023-10-06T08:05:00.000Z',
            },
          ],
        },
      })]);
    nock('https://config.aem.page')
      .get('/main--site1--org1/config.json?scope=admin')
      .reply(200, {
        content: {
          contentBusId: 1234,
          source: {
            url: 'https://drive.google.com/drive/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
            type: 'google',
          },
        },
        code: {
          owner: 'owner',
          repo: 'repo',
        },
      })
      .get('/main--site2--org2/config.json?scope=admin')
      .reply(200, {
        content: {
          contentBusId: 5678,
          source: {
            url: 'https://drive.google.com/drive/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my2',
            type: 'google',
          },
        },
        code: {
          owner: 'owner',
          repo: 'repo',
        },
      });
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/1234/.hlx.json?x-id=GetObject')
      .reply(200, {
        'original-site': 'org1/site1',
        'original-repq': 'owner/repo',
      })
      .head('/1234/.helix-auth/auth-google-content.json')
      .reply(404)
      .get('/5678/.hlx.json?x-id=GetObject')
      .reply(200, {
        'original-site': 'org2/site2',
        'original-repq': 'owner/repo',
      });

    const { request, context } = setupTest('*', undefined, {
      env: {
        HLX_CUSTOM_GOOGLE_USERS: 'org1/*',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(inventory, {
      entries: [
        {
          codeBusId: 'owner/repo',
          contentBusId: 5678,
          contentSourceUrl: 'https://drive.google.com/drive/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my2',
          gdriveId: '1N2zij7EMeS95cIFiRuxfjY0OxllX8my2',
          org: 'org2',
          originalSite: 'org2/site2',
          site: 'site2',
        },
        {
          codeBusId: 'owner/repo',
          contentBusId: 1234,
          contentSourceUrl: 'https://drive.google.com/drive/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
          gdriveId: '1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
          org: 'org1',
          originalSite: 'org1/site1',
          site: 'site1',
        },
      ],
      hostTypes: {
        'drive.google.com': 'google',
      },
    });
  });

  it('reindex one project returns 201 when it succeeds', async () => {
    nock.siteConfig({
      ...SITE_CONFIG,
      cdn: {
        prod: {
          type: 'fastly',
          serviceId: '1234',
        },
      },
    });

    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get(`/${SITE_CONFIG.content.contentBusId}/.hlx.json?x-id=GetObject`)
      .reply(200, {
        'original-site': 'org/site',
      })
      .head(`/${SITE_CONFIG.content.contentBusId}/.helix-auth/auth-google-content.json`)
      .reply(200);

    nock.inventory([{
      contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
      contentSourceUrl: 'https://drive.google.com/drive/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
      org: 'org',
      site: 'site',
      codeBusId: 'owner/repo',
    }]);

    const { request, context } = setupTest('org', 'site', {
      env: {
        HLX_CUSTOM_GOOGLE_USERS: 'org/*',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 201);
    assert.deepStrictEqual(inventory, {
      entries: [
        {
          cdnId: 'fastly:1234',
          codeBusId: 'owner/repo',
          contentBusId: SITE_CONFIG.content.contentBusId,
          contentSourceUrl: 'https://drive.google.com/drive/u/0/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
          customUser: true,
          gdriveId: '18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
          org: 'org',
          originalSite: 'org/site',
          site: 'site',
        },
      ],
      hostTypes: {
        'drive.google.com': 'google',
      },
    });
  });

  it('reindex one project can claim the original site', async () => {
    nock.siteConfig()
      .twice()
      .reply(200, SITE_CONFIG);
    nock.content()
      .getObject('/.hlx.json')
      .reply(404)
      .putObject('/.hlx.json')
      .reply(200, (uri, body) => {
        assert.deepStrictEqual(body, {
          'original-site': 'org/site',
        });
        return [200];
      })
      .getObject('/.hlx.json')
      .reply(200, {
        'original-site': 'org/site',
      });
    nock.inventory()
      .reply(200, {
        entries: [],
        hostTypes: {},
      });

    const { request, context } = setupTest('org', 'site', {
      authInfo: new AuthInfo().withRole('ops').withAuthenticated(true),
      claimOriginalSite: true,
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 201);
    assert.deepStrictEqual(inventory, {
      entries: [{
        codeBusId: 'owner/repo',
        contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
        contentSourceUrl: 'https://drive.google.com/drive/u/0/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
        gdriveId: '18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
        originalSite: 'org/site',
        org: 'org',
        site: 'site',
      }],
      hostTypes: {
        'drive.google.com': 'google',
      },
    });
  });

  it('reindex one project can claim the original site and reindexes the old site', async () => {
    nock.siteConfig()
      .twice()
      .reply(200, SITE_CONFIG);
    nock.siteConfig(SITE_CONFIG, { org: 'org', site: 'old-site' });

    nock.content()
      .getObject('/.hlx.json')
      .reply(200, {
        'original-site': 'org/old-site',
      })
      .putObject('/.hlx.json')
      .reply(200, (uri, body) => {
        assert.deepStrictEqual(body, {
          'original-site': 'org/site',
        });
        return [200];
      })
      .getObject('/.hlx.json')
      .twice()
      .reply(200, {
        'original-site': 'org/site',
      });
    nock.inventory()
      .reply(200, {
        entries: [{
          codeBusId: 'owner/repo',
          contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
          contentSourceUrl: 'https://drive.google.com/drive/u/0/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
          gdriveId: '18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
          originalSite: 'org/old-site',
          org: 'org',
          site: 'old-site',
        }],
        hostTypes: {
          'drive.google.com': 'google',
        },
      });
    nock.content('default')
      .getObject('/inventory-v2.json')
      .reply(() => [200, inventory])
      .putObject('/inventory-v2.json')
      .reply((_, body) => {
        inventory = body;
        return [201];
      });

    const { request, context } = setupTest('org', 'site', {
      authInfo: new AuthInfo().withRole('ops').withAuthenticated(true),
      claimOriginalSite: true,
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 201);
    assert.deepStrictEqual(inventory, {
      entries: [{
        codeBusId: 'owner/repo',
        contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
        contentSourceUrl: 'https://drive.google.com/drive/u/0/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
        gdriveId: '18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
        originalSite: 'org/site',
        org: 'org',
        site: 'old-site',
      }, {
        codeBusId: 'owner/repo',
        contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
        contentSourceUrl: 'https://drive.google.com/drive/u/0/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
        gdriveId: '18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
        originalSite: 'org/site',
        org: 'org',
        site: 'site',
      }],
      hostTypes: {
        'drive.google.com': 'google',
      },
    });
  });

  it('reindex one project returns 201 when it succeeds and inventory was empty', async () => {
    nock.siteConfig({
      ...SITE_CONFIG,
      content: {
        ...SITE_CONFIG.content,
        source: {
          type: 'onedrive',
          url: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA',
        },
      },
    });

    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get(`/${SITE_CONFIG.content.contentBusId}/.hlx.json?x-id=GetObject`)
      .reply(200, {
        'original-site': 'org/site',
      });

    nock.inventory().reply(404);

    const { request, context } = setupTest('org', 'site');
    const response = await main(request, context);

    assert.strictEqual(response.status, 201);
    assert.deepStrictEqual(inventory, {
      entries: [
        {
          codeBusId: 'owner/repo',
          contentBusId: SITE_CONFIG.content.contentBusId,
          contentSourceUrl: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2Fsubsites%2FShared%20Documents%2FsubsiteA',
          org: 'org',
          originalSite: 'org/site',
          sharepointSite: 'https://company.sharepoint.com/sites/subsites/Shared%20Documents/subsiteA',
          site: 'site',
        },
      ],
      hostTypes: {
        'company.sharepoint.com': 'sharepoint',
      },
    });
  });

  it('reindex one project returns 200 when the entry is already in the inventory', async () => {
    nock.siteConfig(SITE_CONFIG);

    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get(`/${SITE_CONFIG.content.contentBusId}/.hlx.json?x-id=GetObject`)
      .reply(200, {
        'original-site': 'org/site',
      });

    nock.inventory([{
      codeBusId: 'owner/repo',
      contentBusId: SITE_CONFIG.content.contentBusId,
      contentSourceUrl: SITE_CONFIG.content.source.url,
      gdriveId: SITE_CONFIG.content.source.id,
      org: 'org',
      originalSite: 'org/site',
      site: 'site',
    }]);

    const { request, context } = setupTest('org', 'site');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
  });

  it('reindex one project returns 404 when site is not found', async () => {
    nock.siteConfig().reply(404);

    const { request, context } = setupTest('org', 'site');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'Unable to obtain information on project org/site',
    });
  });
});
