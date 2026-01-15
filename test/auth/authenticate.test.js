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
import {
  exportJWK, generateKeyPair, SignJWT,
} from 'jose';
import { ADMIN_CLIENT_ID } from '../../src/auth/clients.js';
import { BEARER_IDP } from '../../src/auth/support.js';
import idpAdmin from '../../src/idp-configs/admin.js';
import idpImsStage from '../../src/idp-configs/ims-stg.js';
import idpMicrosoft from '../../src/idp-configs/microsoft.js';
import idpFakeTestIDP from '../idp-configs/test-idp.js';
import {
  createContext, createInfo, Nock, ORG_CONFIG, SITE_CONFIG,
} from '../utils.js';

describe('Authentication Test', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  let privateKey;

  before(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey;
    // privateJwk = await jose.exportJWK(privateKey);
    const publicJwk = await exportJWK(keyPair.publicKey);
    idpAdmin.discovery.jwks = {
      keys: [
        publicJwk,
      ],
    };
    idpFakeTestIDP.discovery.jwks = {
      keys: [
        publicJwk,
      ],
    };
  });

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
    delete process.env.TEST_CLIENT_ID;

    BEARER_IDP.default = idpMicrosoft;
    BEARER_IDP.token = idpAdmin;
  });

  function setupTest({
    attributes, headers, suffix = '/org/sites/site/status/', env,
  } = {}) {
    const context = createContext(suffix, {
      attributes: {
        authInfo: undefined,
        config: undefined,
        ...attributes,
      },
      env,
    });
    const info = createInfo(suffix, headers).withCode('owner', 'repo');
    return { context, info };
  }

  describe('`getAuthInfo`', () => {
    beforeEach(() => {
      nock.siteConfig(SITE_CONFIG);
    });

    it('uses existing info', async () => {
      const { context, info } = setupTest({
        attributes: {
          authInfo: 'test',
        },
      });
      const authInfo = await context.authenticate(info);
      assert.strictEqual(authInfo, 'test');
    });

    it('creates unauthenticated role for no auth cookie', async () => {
      const { context, info } = setupTest();
      const authInfo = await context.authenticate(info);

      assert.strictEqual(authInfo.authenticated, false);
      assert.deepStrictEqual(authInfo.toJSON().roles, []);
    });

    it('creates unauthenticated role for no idp_name', async () => {
      const { context, info } = setupTest({
        headers: {
          cookie: 'auth_token=\'id_token=123\'',
        },
      });
      const authInfo = await context.authenticate(info);

      assert.strictEqual(authInfo.authenticated, false);
      assert.deepStrictEqual(authInfo.toJSON().roles, []);
    });

    it('creates unauthenticated role for no id_token', async () => {
      const { context, info } = setupTest({
        headers: {
          cookie: 'auth_token=\'idp_name=foo\'',
        },
      });
      const authInfo = await context.authenticate(info);

      assert.strictEqual(authInfo.authenticated, false);
      assert.deepStrictEqual(authInfo.toJSON().roles, []);
    });

    it('rejects invalid id_token', async () => {
      const { context, info } = setupTest({
        headers: {
          cookie: 'auth_token=\'invalid\'',
        },
      });
      const authInfo = await context.authenticate(info);
      assert.strictEqual(authInfo.cookieInvalid, true);
    });

    it('rejects invalid id_token (x-auth-token header)', async () => {
      const { context, info } = setupTest({
        headers: {
          'x-auth-token': 'idp_name=test&id_token=invalid',
        },
      });
      const authInfo = await context.authenticate(info);
      assert.strictEqual(authInfo.authenticated, false);
    });

    it('properly decodes the id token', async () => {
      const authToken = await new SignJWT({
        email: 'bob',
        name: 'Bob',
        userId: '112233',
        imsToken: 'ims-token',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('https://admin.hlx.page/')
        .setSubject('*/*')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      const { context, info } = setupTest({
        headers: {
          cookie: `auth_token=${authToken}`,
        },
      });
      const authInfo = await context.authenticate(info);

      assert.ok(authInfo.profile.exp);
      assert.ok(authInfo.profile.iat);
      assert.strictEqual(authInfo.imsToken, 'ims-token');

      delete authInfo.profile.exp;
      delete authInfo.profile.iat;
      assert.strictEqual(authInfo.authenticated, true);
      assert.strictEqual(authInfo.authToken, authToken);
      assert.ok(Math.abs(authInfo.profile.ttl - 7200) < 2);
      delete authInfo.profile.ttl;
      assert.deepStrictEqual(authInfo.profile, {
        aud: 'dummy-clientid',
        email: 'bob',
        iss: 'https://admin.hlx.page/',
        name: 'Bob',
        userId: '112233',
      });
    });

    it('properly decodes the id token (x-auth-token header)', async () => {
      const authToken = await new SignJWT({
        email: 'bob',
        name: 'Bob',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('https://admin.hlx.page/')
        .setSubject('*/*')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      const { context, info } = setupTest({
        headers: {
          'x-auth-token': authToken,
        },
      });
      const authInfo = await context.authenticate(info);

      assert.ok(authInfo.profile.exp);
      assert.ok(authInfo.profile.iat);
      delete authInfo.profile.exp;
      delete authInfo.profile.iat;
      assert.strictEqual(authInfo.authenticated, true);
      assert.strictEqual(authInfo.authToken, authToken);
      assert.ok(Math.abs(authInfo.profile.ttl - 7200) < 2);
      delete authInfo.profile.ttl;
      assert.deepStrictEqual(authInfo.profile, {
        aud: 'dummy-clientid',
        email: 'bob',
        iss: 'https://admin.hlx.page/',
        name: 'Bob',
        userId: '112233',
      });
    });

    it('properly decodes the id token (x-auth-token header from sidekick', async () => {
      const authToken = await new SignJWT({
        email: 'bob',
        name: 'Bob',
        iss: 'https://admin.hlx.page/',
        userId: '112233',
        extensionId: '1234',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('https://admin.hlx.page/')
        .setSubject('*/*')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      const { context, info } = setupTest({
        headers: {
          'x-auth-token': authToken,
        },
      });
      const authInfo = await context.authenticate(info);

      assert.ok(authInfo.profile.exp);
      assert.ok(authInfo.profile.iat);
      delete authInfo.profile.exp;
      delete authInfo.profile.iat;
      assert.strictEqual(authInfo.authenticated, true);
      assert.strictEqual(authInfo.authToken, authToken);
      assert.strictEqual(authInfo.extensionId, '1234');
      assert.ok(Math.abs(authInfo.profile.ttl - 7200) < 2);
      delete authInfo.profile.ttl;
      assert.deepStrictEqual(authInfo.profile, {
        aud: 'dummy-clientid',
        email: 'bob',
        iss: 'https://admin.hlx.page/',
        name: 'Bob',
        userId: '112233',
      });
    });

    it.skip('uses roles in the id token for the correct audience', async () => {
      const authToken = await new SignJWT({
        email: 'bob',
        name: 'Bob',
        userId: '112233',
        roles: [
          'author',
          'publish',
        ],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('https://admin.hlx.page/')
        .setSubject('*/*')
        .setAudience(ADMIN_CLIENT_ID)
        .setJti('abc')
        .setExpirationTime('2h')
        .sign(privateKey);

      const { context, info } = setupTest({
        headers: {
          'x-auth-token': authToken,
        },
      });
      const authInfo = await context.authenticate(info);

      assert.ok(authInfo.profile.exp);
      assert.ok(authInfo.profile.iat);
      delete authInfo.profile.exp;
      delete authInfo.profile.iat;
      assert.strictEqual(authInfo.authenticated, true);
      assert.deepStrictEqual(authInfo.toJSON().roles, ['author', 'publish']);
      assert.ok(Math.abs(authInfo.profile.ttl - 7200) < 2);
      delete authInfo.profile.ttl;
      assert.deepStrictEqual(authInfo.profile, {
        aud: ADMIN_CLIENT_ID,
        email: 'bob',
        iss: 'urn:example:issuer',
        name: 'Bob',
        userId: '112233',
        roles: [
          'author',
          'publish',
        ],
        hlx_hash: 'pbLGCu04IJ7usuyfAthFfHab_Oc',
      });
    });

    it('uses the bearer token for the correct audience', async () => {
      const accessToken = await new SignJWT({
        email: 'bob',
        name: 'Bob',
        userId: '112233',
        roles: [
          'author',
          'publish',
        ],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(ADMIN_CLIENT_ID)
        .setExpirationTime('2h')
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.default = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      const authInfo = await context.authenticate(info);

      assert.ok(authInfo.profile.exp);
      assert.ok(authInfo.profile.iat);
      delete authInfo.profile.exp;
      delete authInfo.profile.iat;
      assert.strictEqual(authInfo.authenticated, true);
      assert.deepStrictEqual(authInfo.toJSON().roles, ['author', 'publish']);
      assert.ok(Math.abs(authInfo.profile.ttl - 7200) < 2);
      delete authInfo.profile.ttl;
      assert.deepStrictEqual(authInfo.profile, {
        aud: ADMIN_CLIENT_ID,
        email: 'bob',
        iss: 'urn:example:issuer',
        name: 'Bob',
        userId: '112233',
        roles: [
          'author',
          'publish',
        ],
      });
    });

    it('ignores the bearer token for the invalid audience', async () => {
      const accessToken = await new SignJWT({
        email: 'bob',
        name: 'Bob',
        userId: '112233',
        roles: [
          'author',
          'publish',
        ],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      BEARER_IDP.default = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      const authInfo = await context.authenticate(info);

      assert.strictEqual(authInfo.authenticated, false);
      assert.deepStrictEqual(authInfo.toJSON().roles, []);
    });

    it('ignores invalid bearer token for the invalid audience', async () => {
      const accessToken = await new SignJWT({
        email: 'bob',
        name: 'Bob',
        userId: '112233',
        roles: [
          'author',
          'publish',
        ],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime(Math.floor(Date.now() / 1000 - 8 * 24 * 60 * 60))
        .sign(privateKey);

      BEARER_IDP.default = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      const authInfo = await context.authenticate(info);

      assert.strictEqual(authInfo.authenticated, false);
      assert.deepStrictEqual(authInfo.toJSON().roles, []);
    });

    it.skip('ignores roles in the id token for the wrong audience', async () => {
      const authToken = await new SignJWT({
        email: 'bob',
        name: 'Bob',
        userId: '112233',
        roles: [
          'author',
          'publish',
        ],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('https://admin.hlx.page/')
        .setSubject('*/*')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      const { context, info } = setupTest({
        headers: {
          cookie: `auth_token=${authToken}`,
        },
      });
      const authInfo = await context.authenticate(info);

      assert.ok(authInfo.profile.exp);
      assert.ok(authInfo.profile.iat);
      delete authInfo.profile.exp;
      delete authInfo.profile.iat;
      assert.strictEqual(authInfo.authenticated, true);
      assert.deepStrictEqual(authInfo.toJSON().roles, []);
      assert.ok(Math.abs(authInfo.profile.ttl - 7200) < 2);
      delete authInfo.profile.ttl;
      assert.deepStrictEqual(authInfo.profile, {
        aud: 'dummy-clientid',
        email: 'bob',
        iss: 'urn:example:issuer',
        name: 'Bob',
        userId: '112233',
        roles: [
          'author',
          'publish',
        ],
        hlx_hash: 'pbLGCu04IJ7usuyfAthFfHab_Oc',
      });
    });

    it.skip('decodes the token leniently', async () => {
      const authToken = await new SignJWT({
        email: 'bob',
        name: 'Bob',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime(Math.floor(Date.now() / 1000 - 10))
        .sign(privateKey);

      const { context, info } = setupTest({
        headers: {
          cookie: `auth_token=${authToken}`,
        },
      });
      const authInfo = await context.authenticate(info);

      assert.strictEqual(authInfo.expired, true);
      assert.strictEqual(authInfo.loginHint, 'bob');
      assert.strictEqual(authInfo.profile, null);
      assert.strictEqual(authInfo.authenticated, false);
    });

    it('rejects too old id_token', async () => {
      const idToken = await new SignJWT({
        email: 'bob',
        name: 'Bob',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime(Math.floor(Date.now() / 1000 - 8 * 24 * 60 * 60))
        .sign(privateKey);

      const { context, info } = setupTest({
        headers: {
          cookie: `auth_token=idp_name=test&id_token=${idToken}`,
        },
      });
      const authInfo = await context.authenticate(info);

      assert.strictEqual(authInfo.cookieInvalid, true);
    });
  });

  describe('Site API Token', () => {
    async function testApiToken(sub, jti, apiKeyId, audience = ADMIN_CLIENT_ID) {
      nock.siteConfig({
        ...SITE_CONFIG,
        access: {
          admin: {
            apiKeyId: [apiKeyId],
          },
        },
      });

      const accessToken = await new SignJWT({
        email: 'helix@adobe.com',
        name: 'Helix Admin',
        roles: [
          'author',
          'publish',
        ],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(audience)
        .setExpirationTime('2h')
        .setSubject(sub)
        .setJti(jti)
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.token = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `token ${accessToken}`,
        },
      });
      const authInfo = await context.authenticate(info);

      delete authInfo.profile?.exp;
      delete authInfo.profile?.iat;
      delete authInfo.profile?.ttl;
      return authInfo;
    }

    it('supports the api token', async () => {
      const authInfo = await testApiToken('org/site', '1234', '1234');
      assert.deepStrictEqual(authInfo.profile, {
        aud: '452733d4-6ae5-4590-8d0f-27404a03aca8',
        email: 'helix@adobe.com',
        iss: 'urn:example:issuer',
        name: 'Helix Admin',
        roles: [
          'author',
          'publish',
        ],
      });
    });

    it('supports the api token for owner', async () => {
      const authInfo = await testApiToken('org/*', '1234', '1234');
      assert.deepStrictEqual(authInfo.profile, {
        aud: '452733d4-6ae5-4590-8d0f-27404a03aca8',
        email: 'helix@adobe.com',
        iss: 'urn:example:issuer',
        name: 'Helix Admin',
        roles: [
          'author',
          'publish',
        ],
      });
    });

    it('rejects the api token w/o sub claim', async () => {
      const authInfo = await testApiToken('', '1234', '1234');
      assert.strictEqual(authInfo.authenticated, false);
    });

    it('rejects the api token with invalid sub claim (org mismatch)', async () => {
      const authInfo = await testApiToken('foo/repo', '1234', '1234');
      assert.strictEqual(authInfo.authenticated, false);
    });

    it('rejects the api token with invalid sub claim (site mismatch)', async () => {
      const authInfo = await testApiToken('owner/bar', '1234', '1234');
      assert.strictEqual(authInfo.authenticated, false);
    });

    it('rejects the api token with invalid jti claim', async () => {
      const authInfo = await testApiToken('owner/repo', '4567', '1234');
      assert.strictEqual(authInfo.authenticated, false);
    });

    it('rejects the api token with missing apiKeyId', async () => {
      const authInfo = await testApiToken('owner/repo', '4567', undefined);
      assert.strictEqual(authInfo.authenticated, false);
    });

    it('rejects the api token with invalid JWT', async () => {
      const authInfo = await testApiToken('owner/*', '1234', '1234', 'invalid');
      assert.strictEqual(authInfo.authenticated, false);
    });
  });

  describe('Org API Token', () => {
    it('supports api tokens with permissions but on no org/site route', async () => {
      const accessToken = await new SignJWT({
        email: 'helix@adobe.com',
        name: 'Helix Admin',
        scopes: ['discover:list'],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(ADMIN_CLIENT_ID)
        .setExpirationTime('2h')
        .setSubject('*/*')
        .setJti('1234')
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.token = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `token ${accessToken}`,
        },
        suffix: '/login',
      });
      const authInfo = await context.authenticate(info);

      delete authInfo.profile?.exp;
      delete authInfo.profile?.iat;
      delete authInfo.profile?.ttl;
      assert.strictEqual(authInfo.authenticated, true);
      assert.strictEqual(authInfo.hasPermissions('discover:list'), true);
    });

    it('supports org-wide api token', async () => {
      nock.orgConfig({
        ...ORG_CONFIG,
        access: {
          admin: {
            apiKeyId: ['1234'],
          },
        },
      });

      const accessToken = await new SignJWT({
        email: 'helix@adobe.com',
        name: 'Helix Admin',
        roles: ['config_admin'],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(ADMIN_CLIENT_ID)
        .setExpirationTime('2h')
        .setSubject('org/*')
        .setJti('1234')
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.token = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `token ${accessToken}`,
        },
        suffix: '/org/config',
      });
      const authInfo = await context.authenticate(info);

      delete authInfo.profile?.exp;
      delete authInfo.profile?.iat;
      delete authInfo.profile?.ttl;
      assert.strictEqual(authInfo.authenticated, true);
      assert.strictEqual(authInfo.hasPermissions('config:write'), true);
    });

    it('rejects org-wide api token missing in config', async () => {
      nock.orgConfig({
        ...ORG_CONFIG,
        access: {
          admin: {
            apiKeyId: ['5678'],
          },
        },
      });

      const accessToken = await new SignJWT({
        email: 'helix@adobe.com',
        name: 'Helix Admin',
        roles: ['config_admin'],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(ADMIN_CLIENT_ID)
        .setExpirationTime('2h')
        .setSubject('org/*')
        .setJti('1234')
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.token = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `token ${accessToken}`,
        },
        suffix: '/org/config',
      });
      const authInfo = await context.authenticate(info);

      delete authInfo.profile?.exp;
      delete authInfo.profile?.iat;
      delete authInfo.profile?.ttl;
      assert.strictEqual(authInfo.authenticated, false);
      assert.strictEqual(authInfo.hasPermissions('config:write'), false);
    });

    it('rejects org-wide api token missing in config for org access', async () => {
      nock.orgConfig({
        ...ORG_CONFIG,
        access: {
          admin: {
            apiKeyId: ['5678'],
          },
        },
      });

      const accessToken = await new SignJWT({
        email: 'helix@adobe.com',
        name: 'Helix Admin',
        roles: ['config_admin'],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(ADMIN_CLIENT_ID)
        .setExpirationTime('2h')
        .setSubject('org/*')
        .setJti('1234')
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.token = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `token ${accessToken}`,
        },
        suffix: '/org/config',
      });
      const authInfo = await context.authenticate(info);

      delete authInfo.profile?.exp;
      delete authInfo.profile?.iat;
      delete authInfo.profile?.ttl;
      assert.strictEqual(authInfo.authenticated, false);
      assert.strictEqual(authInfo.hasPermissions('config:write'), false);
    });

    it('supports wildcard org api token with valid JTI in allow list', async () => {
      nock.orgConfig(ORG_CONFIG);

      const accessToken = await new SignJWT({
        email: 'helix@adobe.com',
        name: 'Helix Admin',
        roles: ['config_admin'],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(ADMIN_CLIENT_ID)
        .setExpirationTime('2h')
        .setSubject('*/site')
        .setJti('allowed-jti-123')
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.token = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `token ${accessToken}`,
        },
        suffix: '/org/config',
        env: {
          HLX_GLOBAL_API_KEY_ALLOWLIST: 'allowed-jti-123, another-allowed-jti',
        },
      });
      const authInfo = await context.authenticate(info);

      delete authInfo.profile?.exp;
      delete authInfo.profile?.iat;
      delete authInfo.profile?.ttl;
      assert.strictEqual(authInfo.authenticated, true);
      assert.strictEqual(authInfo.hasPermissions('config:write'), true);
    });

    it('rejects wildcard org api token with JTI not in allow list', async () => {
      nock.orgConfig(ORG_CONFIG);

      const accessToken = await new SignJWT({
        email: 'helix@adobe.com',
        name: 'Helix Admin',
        roles: ['config_admin'],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(ADMIN_CLIENT_ID)
        .setExpirationTime('2h')
        .setSubject('*/site')
        .setJti('not-allowed-jti')
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.token = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `token ${accessToken}`,
        },
        suffix: '/org/config',
        env: {
          HLX_GLOBAL_API_KEY_ALLOWLIST: 'allowed-jti-123, another-allowed-jti',
        },
      });
      const authInfo = await context.authenticate(info);

      delete authInfo.profile?.exp;
      delete authInfo.profile?.iat;
      delete authInfo.profile?.ttl;
      assert.strictEqual(authInfo.authenticated, false);
      assert.strictEqual(authInfo.hasPermissions('config:write'), false);
    });

    it('rejects wildcard org api token when allow list is missing', async () => {
      nock.orgConfig(ORG_CONFIG);

      const accessToken = await new SignJWT({
        email: 'helix@adobe.com',
        name: 'Helix Admin',
        roles: ['config_admin'],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(ADMIN_CLIENT_ID)
        .setExpirationTime('2h')
        .setSubject('*/site')
        .setJti('some-jti')
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.token = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `token ${accessToken}`,
        },
        suffix: '/org/config',
      });
      const authInfo = await context.authenticate(info);

      delete authInfo.profile?.exp;
      delete authInfo.profile?.iat;
      delete authInfo.profile?.ttl;
      assert.strictEqual(authInfo.authenticated, false);
      assert.strictEqual(authInfo.hasPermissions('config:write'), false);
    });

    it('supports wildcard org api token with empty allow list', async () => {
      nock.orgConfig(ORG_CONFIG);

      const accessToken = await new SignJWT({
        email: 'helix@adobe.com',
        name: 'Helix Admin',
        roles: ['config_admin'],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(ADMIN_CLIENT_ID)
        .setExpirationTime('2h')
        .setSubject('*/site')
        .setJti('some-jti')
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.token = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `token ${accessToken}`,
        },
        suffix: '/org/config',
        env: {
          HLX_GLOBAL_API_KEY_ALLOWLIST: '',
        },
      });
      const authInfo = await context.authenticate(info);

      delete authInfo.profile?.exp;
      delete authInfo.profile?.iat;
      delete authInfo.profile?.ttl;
      assert.strictEqual(authInfo.authenticated, false);
      assert.strictEqual(authInfo.hasPermissions('config:write'), false);
    });

    it('supports wildcard org api token with comma-separated allow list (with spaces)', async () => {
      nock.orgConfig(ORG_CONFIG);

      const accessToken = await new SignJWT({
        email: 'helix@adobe.com',
        name: 'Helix Admin',
        roles: ['config_admin'],
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience(ADMIN_CLIENT_ID)
        .setExpirationTime('2h')
        .setSubject('*/site')
        .setJti('spaced-jti')
        .sign(privateKey);

      process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
      BEARER_IDP.token = idpFakeTestIDP;

      const { context, info } = setupTest({
        headers: {
          authorization: `token ${accessToken}`,
        },
        suffix: '/org/config',
        env: {
          HLX_GLOBAL_API_KEY_ALLOWLIST: ' first-jti , spaced-jti , third-jti ',
        },
      });
      const authInfo = await context.authenticate(info);

      delete authInfo.profile?.exp;
      delete authInfo.profile?.iat;
      delete authInfo.profile?.ttl;
      assert.strictEqual(authInfo.authenticated, true);
      assert.strictEqual(authInfo.hasPermissions('config:write'), true);
    });
  });
});

describe('IMS Authentication Test', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  let privateKey;

  function setupTest({
    attributes, headers, suffix = '/org/sites/site/status/', env,
  } = {}) {
    const context = createContext(suffix, {
      attributes: {
        authInfo: undefined,
        config: undefined,
        ...attributes,
      },
      env,
    });
    const info = createInfo(suffix, headers).withCode('owner', 'repo');
    return { context, info };
  }

  before(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey;
    // privateJwk = await jose.exportJWK(privateKey);
    const publicJwk = await exportJWK(keyPair.publicKey);
    idpImsStage.discovery.jwks = {
      keys: [
        {
          ...publicJwk,
          kid: 'ims',
        },
      ],
    };
  });

  after(() => {
    delete idpImsStage.discovery.jwks;
  });

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
  });

  afterEach(() => {
    nock.done();
  });

  async function testIMSToken(payload = {}) {
    const accessToken = await new SignJWT({
      type: 'access_token',
      as: 'ims-na1-stg1',
      user_id: 'helix@adobe.com',
      scope: 'aem.backend.all,openid,AdobeID',
      client_id: 'foobar-client',
      expires_in: '86400000',
      created_at: String(Date.now() - 1000),
      ...payload,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'ims' })
      .sign(privateKey);

    const { context, info } = setupTest({
      headers: {
        authorization: `bearer ${accessToken}`,
      },
      suffix: '/org/sites/site/config',
    });
    const authInfo = await context.authenticate(info);

    delete authInfo.profile?.ttl;
    delete authInfo.profile?.created_at;
    return { authInfo, accessToken };
  }

  it('supports the ims backend token (stage)', async () => {
    nock('https://ims-na1-stg1.adobelogin.com')
      .get('/ims/profile/v1')
      .reply(404);
    const { authInfo, accessToken } = await testIMSToken();
    assert.deepStrictEqual(authInfo.profile, {
      as: 'ims-na1-stg1',
      client_id: 'foobar-client',
      user_id: 'helix@adobe.com',
      expires_in: '86400000',
      defaultRole: 'publish',
      scope: 'aem.backend.all,openid,AdobeID',
    });
    assert.strictEqual(authInfo.imsToken, accessToken);
  });

  it('supports the ims backend token and fetches ims profile', async () => {
    nock('https://ims-na1-stg1.adobelogin.com')
      .get('/ims/profile/v1')
      .reply(200, {
        email: 'test@adobe.com',
      });
    const { authInfo, accessToken } = await testIMSToken();
    assert.deepStrictEqual(authInfo.profile, {
      as: 'ims-na1-stg1',
      client_id: 'foobar-client',
      user_id: 'helix@adobe.com',
      expires_in: '86400000',
      defaultRole: 'publish',
      email: 'test@adobe.com',
      scope: 'aem.backend.all,openid,AdobeID',
    });
    assert.strictEqual(authInfo.imsToken, accessToken);
  });

  it('supports the ims backend token with failed fetch from ims profile', async () => {
    nock('https://ims-na1-stg1.adobelogin.com')
      .get('/ims/profile/v1')
      .replyWithError('boom!');
    const { authInfo, accessToken } = await testIMSToken();
    assert.deepStrictEqual(authInfo.profile, {
      as: 'ims-na1-stg1',
      client_id: 'foobar-client',
      user_id: 'helix@adobe.com',
      expires_in: '86400000',
      defaultRole: 'publish',
      scope: 'aem.backend.all,openid,AdobeID',
    });
    assert.strictEqual(authInfo.imsToken, accessToken);
  });

  it('supports the ims backend token with user defined roles (stage)', async () => {
    nock('https://ims-na1-stg1.adobelogin.com')
      .get('/ims/profile/v1')
      .reply(404);
    const { authInfo, accessToken } = await testIMSToken({
      roles: ['developer'],
    });
    assert.deepStrictEqual(authInfo.profile, {
      as: 'ims-na1-stg1',
      client_id: 'foobar-client',
      user_id: 'helix@adobe.com',
      expires_in: '86400000',
      roles: ['developer'],
      defaultRole: 'publish',
      scope: 'aem.backend.all,openid,AdobeID',
    });
    assert.strictEqual(authInfo.imsToken, accessToken);
  });

  it('supports the ims frontend token (stage)', async () => {
    nock('https://ims-na1-stg1.adobelogin.com')
      .get('/ims/profile/v1')
      .reply(404);
    const { authInfo, accessToken } = await testIMSToken({
      scope: 'aem.frontend.all,openid,AdobeID',
    });
    assert.deepStrictEqual(authInfo.profile, {
      as: 'ims-na1-stg1',
      client_id: 'foobar-client',
      user_id: 'helix@adobe.com',
      expires_in: '86400000',
      scope: 'aem.frontend.all,openid,AdobeID',
    });
    assert.strictEqual(authInfo.imsToken, accessToken);
  });

  it('supports the ims cm-repo-service token (stage)', async () => {
    nock('https://ims-na1-stg1.adobelogin.com')
      .get('/ims/profile/v1')
      .reply(404);
    const { authInfo } = await testIMSToken({
      scope: 'read_pc.dma_tartan,system,read_pc.dma_aem_ams,openid,AdobeID,additional_info.projectedProductContext,acp.core.pipeline',
      client_id: 'cm-repo-service',
    });
    assert.deepStrictEqual(authInfo.profile, {
      as: 'ims-na1-stg1',
      client_id: 'cm-repo-service',
      user_id: 'helix@adobe.com',
      expires_in: '86400000',
      roles: [
        'develop',
      ],
      defaultRole: 'publish',
      scope: 'read_pc.dma_tartan,system,read_pc.dma_aem_ams,openid,AdobeID,additional_info.projectedProductContext,acp.core.pipeline',
    });
  });

  it('rejects ims tokens with missing user_id', async () => {
    const { authInfo } = await testIMSToken({
      user_id: null,
    });
    assert.strictEqual(authInfo.authenticated, false);
    assert.ok(!authInfo.imsToken);
  });

  it('rejects ims tokens with wrong type', async () => {
    const { authInfo } = await testIMSToken({
      type: 'authorization_code',
    });
    assert.strictEqual(authInfo.authenticated, false);
    assert.ok(!authInfo.imsToken);
  });

  it('rejects ims tokens with missing scope', async () => {
    const { authInfo } = await testIMSToken({
      scope: null,
    });
    assert.strictEqual(authInfo.authenticated, false);
    assert.ok(!authInfo.imsToken);
  });

  it('rejects ims tokens with invalid scope', async () => {
    const { authInfo } = await testIMSToken({
      scope: 'AdobeId',
    });
    assert.strictEqual(authInfo.authenticated, false);
    assert.ok(!authInfo.imsToken);
  });

  it('rejects ims tokens with invalid expires_in', async () => {
    const { authInfo } = await testIMSToken({
      expires_in: 'hello, world',
    });
    assert.strictEqual(authInfo.authenticated, false);
    assert.ok(!authInfo.imsToken);
  });

  it('rejects ims tokens with invalid created_at', async () => {
    const { authInfo } = await testIMSToken({
      created_at: 'hello, world',
    });
    assert.strictEqual(authInfo.authenticated, false);
    assert.ok(!authInfo.imsToken);
  });

  it('rejects ims tokens with created_at in the future', async () => {
    const { authInfo } = await testIMSToken({
      created_at: Date.now() + 1000,
    });
    assert.strictEqual(authInfo.authenticated, false);
    assert.ok(!authInfo.imsToken);
  });

  it('rejects expired ims tokens', async () => {
    const { authInfo } = await testIMSToken({
      created_at: Date.now() - 10000,
      expires_in: 5000,
    });
    assert.strictEqual(authInfo.authenticated, false);
    assert.ok(!authInfo.imsToken);
  });
});
