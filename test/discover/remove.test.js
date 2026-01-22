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
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';

describe('Discover remove tests', () => {
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
  } = {}) {
    const suffix = '/discover';
    const query = new URLSearchParams(Object.entries({ org, site }).filter(([, v]) => !!v));

    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      method: 'DELETE',
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
      },
    };
    return { request, context };
  }

  beforeEach(() => {
    nock.content('default')
      .putObject('/inventory-v2.json')
      .optionally(true)
      .reply((_, body) => {
        inventory = body;
        return [201];
      });
    nock('https://helix-content-bus.cloudflare-account.r2.cloudflarestorage.com')
      .put('/default/inventory-v2.json?x-id=PutObject')
      .optionally(true)
      .reply(201);
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

  it('returns 400 if not both `org` and `site` are specified', async () => {
    const { request, context } = setupTest('org', null);
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'remove requires `org` and `site`',
    });
  });

  it('remove one project returns 204 when it succeeds', async () => {
    nock.inventory([{
      contentBusId: SITE_CONFIG.content.contentBusId,
      contentSourceUrl: 'https://drive.google.com/drive/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
      org: 'org',
      site: 'site',
    }]);

    const { request, context } = setupTest('org', 'site');
    const response = await main(request, context);

    assert.strictEqual(response.status, 204);
    assert.deepStrictEqual(inventory, {
      entries: [],
      hostTypes: {},
    });
  });

  it('remove one project returns 404 when it is not found', async () => {
    nock.inventory([{
      contentBusId: SITE_CONFIG.content.contentBusId,
      contentSourceUrl: 'https://drive.google.com/drive/folders/1N2zij7EMeS95cIFiRuxfjY0OxllX8my1',
      org: 'org',
      site: 'site',
    }]);

    const { request, context } = setupTest('org', 'other');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
  });
});
