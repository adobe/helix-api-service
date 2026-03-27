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
import { Request, Response } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { AdminConfigStore } from '../../src/config/admin-config-store.js';
import { main } from '../../src/index.js';
import { Nock, ORG_CONFIG } from '../utils.js';

describe('Config Handler Tests', () => {
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

  function setupTest(suffix, {
    authInfo = AuthInfo.Admin().withAuthenticated(true),
    data = {},
    method = 'GET',
  } = {}) {
    const query = new URLSearchParams(data);
    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      method,
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo,
        infoMarkerChecked: true,
      },
      runtime: { region: 'us-east-1' },
      env: {
        HELIX_STORAGE_DISABLE_R2: 'true',
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
      },
    };
    return { request, context };
  }

  describe('orgs', () => {
    it('read config', async () => {
      nock.orgConfig(ORG_CONFIG);
      nock.config()
        .getObject('/orgs/org/config.json')
        .reply(200, { version: 1 });

      const { request, context } = setupTest('/org/config.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), { version: 1 });
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json',
        vary: 'Accept-Encoding',
      });
    });

    it('list sites', async () => {
      nock.orgConfig().reply(404);
      nock.listObjects('helix-config-bus', 'orgs/org/sites/', [
        { Key: 'site1.json' },
        { Key: 'site2.json' },
        { Key: 'debug.txt' },
      ]);

      const { request, context } = setupTest('/org/sites');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        sites: [
          { name: 'site1', path: '/config/org/sites/site1.json' },
          { name: 'site2', path: '/config/org/sites/site2.json' },
        ],
      });
    });

    const SITE_1_CONFIG = {
      content: {
        url: '123',
      },
      code: {
        owner: 'adobe', repo: 'repo-1',
      },
    };
    const SITE_2_CONFIG = {
      content: {
        url: '345',
      },
      code: {
        owner: 'adobe', repo: 'repo-2',
      },
    };

    it('list sites with details', async () => {
      nock.orgConfig().reply(404);
      nock.listObjects('helix-config-bus', 'orgs/org/sites/', [
        { Key: 'site1.json' },
        { Key: 'site2.json' },
        { Key: 'debug.txt' },
      ]);
      nock.config()
        .getObject('/orgs/org/sites/site1.json')
        .reply(200, SITE_1_CONFIG)
        .getObject('/orgs/org/sites/site2.json')
        .reply(200, SITE_2_CONFIG);

      const { request, context } = setupTest('/org/sites', {
        data: { details: true },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        sites: [
          {
            ...SITE_1_CONFIG,
            name: 'site1',
            path: '/config/org/sites/site1.json',
          },
          {
            ...SITE_2_CONFIG,
            name: 'site2',
            path: '/config/org/sites/site2.json',
          },
        ],
      });
    });

    it('store a secret', async () => {
      sandbox.stub(AdminConfigStore.prototype, 'fetchUpdate').resolves(
        new Response({
          secret: 'secret',
        }),
      );
      nock.orgConfig().reply(404);
      const { request, context } = setupTest('/org/config/secrets.json', {
        method: 'POST',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        secret: 'secret',
      });
    });
  });

  describe('sites', () => {
  });
});
