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
import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { AdminConfigStore } from '../../src/config/AdminConfigStore.js';
import { main } from '../../src/index.js';
import { Nock, ORG_CONFIG, SITE_CONFIG } from '../utils.js';

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
            // remember the constructor arguments of that store
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
      nock.orgConfig(ORG_CONFIG);
    });

    it('read config', async () => {
      nock.config()
        .getObject('/orgs/org/config.json')
        .reply(200, { version: 1 });

      const { request, context } = setupTest('/org/config.json', {
        authInfo: AuthInfo.Default().withProfile({
          email: 'bob@example.com',
        }).withAuthenticated(true),
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), { version: 1 });
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json',
        vary: 'Accept-Encoding',
      });
    });

    it('read fragment', async () => {
      nock.config()
        .getObject('/orgs/org/config.json')
        .reply(200, ORG_CONFIG);

      const { request, context } = setupTest('/org/config/access/admin.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json',
        vary: 'Accept-Encoding',
      });
      assert.deepStrictEqual(await response.json(), ORG_CONFIG.access.admin);
    });

    it('denies unauthorized access', async () => {
      const { request, context } = setupTest('/org/config.json', {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 403);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'not authorized',
      });
    });

    it('reject unknown method', async () => {
      const { request, context } = setupTest('/org/config.json', {
        method: 'PROPPATCH',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 405);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'method not allowed',
      });
    });

    it('reject unknown extension', async () => {
      const { request, context } = setupTest('/org/config/content.xml');
      const response = await main(request, context);

      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        vary: 'Accept-Encoding',
        'x-error': 'invalid config type',
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

    const SITE_DETAILS = [{
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
        .reply(200, SITE_DETAILS[0])
        .getObject('/orgs/org/sites/site2.json')
        .reply(200, SITE_DETAILS[1]);

      const { request, context } = setupTest('/org/sites', {
        data: { details: true },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        sites: [
          {
            ...SITE_DETAILS[0],
            name: 'site1',
            path: '/config/org/sites/site1.json',
          },
          {
            ...SITE_DETAILS[1],
            name: 'site2',
            path: '/config/org/sites/site2.json',
          },
        ],
      });
    });

    it('list profiles', async () => {
      nock.listObjects('helix-config-bus', 'orgs/org/profiles/', [
        { Key: 'default.json' },
        { Key: 'admin.json' },
        { Key: 'debug.txt' },
      ]);

      const { request, context } = setupTest('/org/profiles');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        profiles: [
          { name: 'default', path: '/config/org/profiles/default.json' },
          { name: 'admin', path: '/config/org/profiles/admin.json' },
        ],
      });
    });

    const PROFILE_DETAILS = [{
      cdn: {
        prod: {
          host: 'some-cdn-host',
        },
      },
    }];

    it('list profiles with details', async () => {
      nock.listObjects('helix-config-bus', 'orgs/org/profiles/', [
        { Key: 'default.json' },
        { Key: 'debug.txt' },
      ]);
      nock.config()
        .getObject('/orgs/org/profiles/default.json')
        .reply(200, PROFILE_DETAILS[0]);

      const { request, context } = setupTest('/org/profiles', {
        data: { details: true },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        profiles: [
          {
            ...PROFILE_DETAILS[0],
            name: 'default',
            path: '/config/org/profiles/default.json',
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

  describe('profiles', () => {
    beforeEach(() => {
      nock.orgConfig(ORG_CONFIG);
    });

    const PROFILE_CONFIG = {
      version: 2,
      cdn: {
        prod: {
          type: 'some-cdn-type',
          host: 'some-cdn-host',
          authToken: 'some-auth-token',
          serviceId: '123456',
        },
      },
    };

    it('read config', async () => {
      nock.config()
        .getObject('/orgs/org/profiles/profile.json')
        .reply(200, PROFILE_CONFIG);

      const { request, context } = setupTest('/org/profiles/profile/config.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json',
        vary: 'Accept-Encoding',
      });
      assert.deepStrictEqual(await response.json(), PROFILE_CONFIG);
    });

    it('read fragment', async () => {
      nock.config()
        .getObject('/orgs/org/profiles/profile.json')
        .reply(200, PROFILE_CONFIG);

      const { request, context } = setupTest('/org/profiles/profile/config/cdn.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json',
        vary: 'Accept-Encoding',
      });
      assert.deepStrictEqual(await response.json(), PROFILE_CONFIG.cdn);
    });
  });

  describe('sites', () => {
    beforeEach(() => {
      nock.siteConfig(SITE_CONFIG);
    });

    it('read config', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site.json')
        .reply(200, SITE_CONFIG);

      const { request, context } = setupTest('/org/sites/site/config.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json',
        vary: 'Accept-Encoding',
      });
      assert.deepStrictEqual(await response.json(), SITE_CONFIG);
    });

    it('read fragment', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site.json')
        .reply(200, SITE_CONFIG);

      const { request, context } = setupTest('/org/sites/site/config/content.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json',
        vary: 'Accept-Encoding',
      });
      assert.deepStrictEqual(await response.json(), SITE_CONFIG.content);
    });

    it('read query.yaml', async () => {
      nock.indexConfig('version 1');

      const { request, context } = setupTest('/org/sites/site/config/query.yaml');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/yaml',
        vary: 'Accept-Encoding',
      });
      assert.deepStrictEqual(await response.text(), 'version 1');
    });

    it('read sitemap.yaml', async () => {
      nock.sitemapConfig('version 2');

      const { request, context } = setupTest('/org/sites/site/config/sitemap.yaml');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/yaml',
        vary: 'Accept-Encoding',
      });
      assert.deepStrictEqual(await response.text(), 'version 2');
    });

    it('reject unknown yaml type', async () => {
      const { request, context } = setupTest('/org/sites/site/config/fstab.yaml');
      const response = await main(request, context);

      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        vary: 'Accept-Encoding',
        'x-error': 'invalid config type',
      });
    });

    it('store `robots.txt`', async () => {
      const { request, context } = setupTest('/org/sites/site/config/robots.txt', {
        method: 'POST',
        data: {
          body: 'User-agent: *\nDisallow: /',
        },
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
    });

    it('reject missing body when storing `robots.txt`', async () => {
      const { request, context } = setupTest('/org/sites/site/config/robots.txt', {
        method: 'POST',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'missing body',
      });
    });
  });

  describe('aggregated', () => {
    beforeEach(() => {
      nock.siteConfig({
        ...SITE_CONFIG,
        access: {
          admin: {
            role: {
              config: [
                'spacecat@example.com',
              ],
            },
          },
        },
      });
    });

    it('read config', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site.json')
        .reply(200, {
          extends: {
            profile: 'default',
          },
          ...SITE_CONFIG,
        })
        .getObject('/orgs/org/profiles/default.json')
        .reply(200, {});

      const { request, context } = setupTest('/org/aggregated/site/config.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json',
        vary: 'Accept-Encoding',
      });
      assert.deepStrictEqual(await response.json(), {
        extends: {
          profile: 'default',
        },
        ...SITE_CONFIG,
      });
    });

    it('read redacted config', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site.json')
        .reply(200, SITE_CONFIG)
        .getObject('/orgs/org/profiles/default.json')
        .reply(404);

      const { request, context } = setupTest('/org/aggregated/site/config.json', {
        authInfo: AuthInfo.Default()
          .withProfile({ email: 'spacecat@example.com' })
          .withAuthenticated(true),
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json',
        vary: 'Accept-Encoding',
      });
      const json = await response.json();
      assert.deepStrictEqual(json, SITE_CONFIG);
    });

    it('return 404 if site not found', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site.json')
        .reply(404);

      const { request, context } = setupTest('/org/aggregated/site/config.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        vary: 'Accept-Encoding',
        'x-error': 'no such config',
      });
    });

    it('read `robots.txt`', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site.json')
        .reply(200, {
          ...SITE_CONFIG,
          robots: {
            txt: 'User-agent: *\nDisallow: /',
          },
        })
        .getObject('/orgs/org/profiles/default.json')
        .reply(404);

      const { request, context } = setupTest('/org/aggregated/site/config/robots.txt');
      const response = await main(request, context);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain',
        vary: 'Accept-Encoding',
      });
      assert.strictEqual(await response.text(), 'User-agent: *\nDisallow: /');
    });

    it('return 404 if `robots.txt` not found', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site.json')
        .reply(200, SITE_CONFIG)
        .getObject('/orgs/org/profiles/default.json')
        .reply(404);

      const { request, context } = setupTest('/org/aggregated/site/config/robots.txt');
      const response = await main(request, context);

      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'no such config',
        vary: 'Accept-Encoding',
      });
    });

    it('reject every method but GET', async () => {
      const { request, context } = setupTest('/org/aggregated/site/config.json', {
        method: 'PUT',
      });
      const response = await main(request, context);

      assert.strictEqual(response.status, 405);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'method not allowed',
      });
    });

    it('reject any subtype but `robots.txt`', async () => {
      const { request, context } = setupTest('/org/aggregated/site/config/content.json');
      const response = await main(request, context);

      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(response.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        vary: 'Accept-Encoding',
        'x-error': 'invalid config type',
      });
    });
  });
});
