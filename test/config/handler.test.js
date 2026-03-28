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
import { exportJWK, generateKeyPair, jwtVerify } from 'jose';
import sinon from 'sinon';
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { AdminConfigStore } from '../../src/config/admin-config-store.js';
import { main } from '../../src/index.js';
import { Nock } from '../utils.js';

/**
 * Stub for the base methods in `AdminConfigStore`.
 */
class ConfigStoreStub {
  /** @type {object} */
  options = null;

  /** @type {Number} */
  created = [];

  /** @type {string[]} */
  updated = [];

  /** @type {string[]} */
  removed = [];

  /** @type {import('sinon').SinonSandbox} */
  constructor(sandbox) {
    const self = this;
    ['create', 'update', 'remove'].forEach((method) => {
      sandbox.stub(AdminConfigStore.prototype, method)
        .callsFake(function fn(...args) {
          if (self.options === null) {
            const { org, type, name } = this;
            self.options = { org, type, name };
          }
          return self[method](...args.slice(1));
        });
    });
  }

  create(data, relPath) {
    this.created.push(relPath);
  }

  update(data, relPath) {
    this.updated.push(relPath);

    return {};
  }

  remove(relPath) {
    this.removed.push(relPath);
  }
}

describe('Config Handler Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  /** @type {ConfigStoreStub} */
  let cs;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
    cs = new ConfigStoreStub(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  function setupTest(suffix, {
    authInfo = AuthInfo.Admin().withAuthenticated(true),
    data = {},
    env = {},
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
        ...env,
        HELIX_STORAGE_DISABLE_R2: 'true',
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
      },
    };
    return { request, context };
  }

  describe('orgs', () => {
    beforeEach(() => {
      nock.orgConfig().reply(404);
    });

    it('read config', async () => {
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

    const SITE_CONFIGS = [{
      content: {
        url: '123',
      },
      code: {
        owner: 'adobe', repo: 'repo-1',
      },
    }, {
      content: {
        url: '345',
      },
      code: {
        owner: 'adobe', repo: 'repo-2',
      },
    }];

    it('list sites with details', async () => {
      nock.listObjects('helix-config-bus', 'orgs/org/sites/', [
        { Key: 'site1.json' },
        { Key: 'site2.json' },
        { Key: 'debug.txt' },
      ]);
      nock.config()
        .getObject('/orgs/org/sites/site1.json')
        .reply(200, SITE_CONFIGS[0])
        .getObject('/orgs/org/sites/site2.json')
        .reply(200, SITE_CONFIGS[1]);

      const { request, context } = setupTest('/org/sites', {
        data: { details: true },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        sites: [
          {
            ...SITE_CONFIGS[0],
            name: 'site1',
            path: '/config/org/sites/site1.json',
          },
          {
            ...SITE_CONFIGS[1],
            name: 'site2',
            path: '/config/org/sites/site2.json',
          },
        ],
      });
    });

    const ORG_VERSIONS = [{
      version: 1,
      created: '2024-01-01T00:00:00.000Z',
      lastModified: '2024-01-01T00:00:00.000Z',
    }, {
      version: 2,
      created: '2024-01-02T00:00:00.000Z',
      name: 'Latest',
      lastModified: '2024-01-02T00:00:00.000Z',
    }];

    it('list org versions', async () => {
      nock.config()
        .getObject('/orgs/org/versions.json')
        .reply(200, {
          current: 2,
          versions: ORG_VERSIONS,
        });

      const { request, context } = setupTest('/org/config/versions.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        current: 2,
        versions: ORG_VERSIONS,
      });
    });

    it('store a secret', async () => {
      const { request, context } = setupTest('/org/config/secrets.json', {
        method: 'POST',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(cs.options, { org: 'org', type: 'org', name: '' });
      assert.deepStrictEqual(cs.updated, ['secrets']);
    });

    it('create an api key', async () => {
      const keyPair = await generateKeyPair('RS256', { extractable: true });
      const privateJwk = await exportJWK(keyPair.privateKey);

      const { request, context } = setupTest('/org/config/apiKeys.json', {
        method: 'POST',
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const response = await main(request, context);
      assert.strictEqual(response.status, 200);

      const json = await response.json();
      const { payload } = await jwtVerify(json.value, keyPair.publicKey);
      assert.deepStrictEqual(payload, {
        email: 'helix@adobe.com',
        exp: payload.exp,
        iat: payload.iat,
        iss: 'https://admin.hlx.page/',
        jti: payload.jti,
        name: 'Helix Admin',
        roles: [
          'author',
        ],
        sub: 'org/',
      });

      assert.deepStrictEqual(cs.options, { org: 'org', type: 'org', name: '' });
      assert.deepStrictEqual(cs.updated, ['apiKeys']);
    });
  });

  describe('sites', () => {
  });
});
