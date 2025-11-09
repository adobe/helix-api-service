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
  createLocalJWKSet, exportJWK, generateKeyPair,
  jwtVerify, SignJWT,
} from 'jose';
import { AccessDeniedError } from '../../src/auth/AccessDeniedError.js';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { authorize } from '../../src/auth/authzn.js';
import { ADMIN_CLIENT_ID } from '../../src/auth/clients.js';
import { PERMISSIONS } from '../../src/auth/permissions.js';
import {
  BEARER_IDP,
  getSiteAuthToken, getTransientSiteTokenInfo,
} from '../../src/auth/support.js';
import idpAdmin from '../../src/idp-configs/admin.js';
import idpImsStage from '../../src/idp-configs/ims-stg.js';
import jwks from '../../src/idp-configs/jwks-json.js';
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

  function setupTest({ attributes, headers, suffix = '/org/sites/site/status/' } = {}) {
    const context = createContext(suffix, {
      attributes: {
        authInfo: undefined,
        config: undefined,
        ...attributes,
      },
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
        apiKeys: {
          ZkC1: {
            id: apiKeyId,
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

  describe.skip('Org API Token (TODO)', () => {
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
        apiKeys: {
          ZkC1: {
            id: '1234',
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
        apiKeys: {
          ZkC1: {
            id: '5678',
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
        suffix: '/org/sites/site/status/',
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
        apiKeys: {
          ZkC1: {
            id: '5678',
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

    it('rejects org-wide api token missing config all', async () => {
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
        .setSubject('org/*')
        .setJti('1234')
        .sign(privateKey);

      nock.configAll('foo-id', null);

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

    it('rejects org-wide api token missing config all (org)', async () => {
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

    // it('supports wildcard org api token with valid JTI in allow list', async () => {
    //   const accessToken = await new SignJWT({
    //     email: 'helix@adobe.com',
    //     name: 'Helix Admin',
    //     roles: ['config_admin'],
    //   })
    //     .setProtectedHeader({ alg: 'RS256' })
    //     .setIssuedAt()
    //     .setIssuer('urn:example:issuer')
    //     .setAudience(ADMIN_CLIENT_ID)
    //     .setExpirationTime('2h')
    //     .setSubject('*/site')
    //     .setJti('allowed-jti-123')
    //     .sign(privateKey);

    //   process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
    //   BEARER_IDP.token = idpFakeTestIDP;
    //   const ctx = DEFAULT_CONTEXT();
    //   ctx.env.HLX_GLOBAL_API_KEY_ALLOWLIST = 'allowed-jti-123, another-allowed-jti';
    //   const authInfo = await authenticate(ctx, {
    //     ...DEFAULT_INFO,
    //     route: 'config',
    //     org: 'testorg',
    //     site: 'site',
    //     headers: {
    //       authorization: `token ${accessToken}`,
    //     },
    //   });
    //   delete authInfo.profile?.exp;
    //   delete authInfo.profile?.iat;
    //   delete authInfo.profile?.ttl;
    //   assert.strictEqual(authInfo.authenticated, true);
    //   assert.strictEqual(authInfo.hasPermissions('config:write'), true);
    // });

    // it('rejects wildcard org api token with JTI not in allow list', async () => {
    //   const accessToken = await new SignJWT({
    //     email: 'helix@adobe.com',
    //     name: 'Helix Admin',
    //     roles: ['config_admin'],
    //   })
    //     .setProtectedHeader({ alg: 'RS256' })
    //     .setIssuedAt()
    //     .setIssuer('urn:example:issuer')
    //     .setAudience(ADMIN_CLIENT_ID)
    //     .setExpirationTime('2h')
    //     .setSubject('*/site')
    //     .setJti('not-allowed-jti')
    //     .sign(privateKey);

    //   process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
    //   BEARER_IDP.token = idpFakeTestIDP;
    //   const ctx = DEFAULT_CONTEXT();
    //   ctx.env.HLX_GLOBAL_API_KEY_ALLOWLIST = 'allowed-jti-123, another-allowed-jti';
    //   const authInfo = await authenticate(ctx, {
    //     ...DEFAULT_INFO,
    //     route: 'config',
    //     org: 'testorg',
    //     site: 'site',
    //     headers: {
    //       authorization: `token ${accessToken}`,
    //     },
    //   });
    //   delete authInfo.profile?.exp;
    //   delete authInfo.profile?.iat;
    //   delete authInfo.profile?.ttl;
    //   assert.strictEqual(authInfo.authenticated, false);
    //   assert.strictEqual(authInfo.hasPermissions('config:write'), false);
    // });

    // it('rejects wildcard org api token when allow list is missing', async () => {
    //   const accessToken = await new SignJWT({
    //     email: 'helix@adobe.com',
    //     name: 'Helix Admin',
    //     roles: ['config_admin'],
    //   })
    //     .setProtectedHeader({ alg: 'RS256' })
    //     .setIssuedAt()
    //     .setIssuer('urn:example:issuer')
    //     .setAudience(ADMIN_CLIENT_ID)
    //     .setExpirationTime('2h')
    //     .setSubject('*/site')
    //     .setJti('some-jti')
    //     .sign(privateKey);

    //   process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
    //   BEARER_IDP.token = idpFakeTestIDP;
    //   const ctx = DEFAULT_CONTEXT();
    //   // No HLX_GLOBAL_API_KEY_ALLOWLIST set (empty allow list means no JTIs are allowed)
    //   const authInfo = await authenticate(ctx, {
    //     ...DEFAULT_INFO,
    //     route: 'config',
    //     org: 'testorg',
    //     site: 'site',
    //     headers: {
    //       authorization: `token ${accessToken}`,
    //     },
    //   });
    //   delete authInfo.profile?.exp;
    //   delete authInfo.profile?.iat;
    //   delete authInfo.profile?.ttl;
    //   assert.strictEqual(authInfo.authenticated, false);
    //   assert.strictEqual(authInfo.hasPermissions('config:write'), false);
    // });

    // it('supports wildcard org api token with empty allow list', async () => {
    //   const accessToken = await new SignJWT({
    //     email: 'helix@adobe.com',
    //     name: 'Helix Admin',
    //     roles: ['config_admin'],
    //   })
    //     .setProtectedHeader({ alg: 'RS256' })
    //     .setIssuedAt()
    //     .setIssuer('urn:example:issuer')
    //     .setAudience(ADMIN_CLIENT_ID)
    //     .setExpirationTime('2h')
    //     .setSubject('*/site')
    //     .setJti('some-jti')
    //     .sign(privateKey);

    //   process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
    //   BEARER_IDP.token = idpFakeTestIDP;
    //   const ctx = DEFAULT_CONTEXT();
    //   ctx.env.HLX_GLOBAL_API_KEY_ALLOWLIST = '';
    //   const authInfo = await authenticate(ctx, {
    //     ...DEFAULT_INFO,
    //     route: 'config',
    //     org: 'testorg',
    //     site: 'site',
    //     headers: {
    //       authorization: `token ${accessToken}`,
    //     },
    //   });
    //   delete authInfo.profile?.exp;
    //   delete authInfo.profile?.iat;
    //   delete authInfo.profile?.ttl;
    //   assert.strictEqual(authInfo.authenticated, false);
    //   assert.strictEqual(authInfo.hasPermissions('config:write'), false);
    // });

    // eslint-disable-next-line max-len
    // it('supports wildcard org api token with comma-separated allow list (with spaces)', async () => {
    //   const accessToken = await new SignJWT({
    //     email: 'helix@adobe.com',
    //     name: 'Helix Admin',
    //     roles: ['config_admin'],
    //   })
    //     .setProtectedHeader({ alg: 'RS256' })
    //     .setIssuedAt()
    //     .setIssuer('urn:example:issuer')
    //     .setAudience(ADMIN_CLIENT_ID)
    //     .setExpirationTime('2h')
    //     .setSubject('*/site')
    //     .setJti('spaced-jti')
    //     .sign(privateKey);

    //   process.env.TEST_CLIENT_ID = ADMIN_CLIENT_ID;
    //   BEARER_IDP.token = idpFakeTestIDP;
    //   const ctx = DEFAULT_CONTEXT();
    //   ctx.env.HLX_GLOBAL_API_KEY_ALLOWLIST = ' first-jti , spaced-jti , third-jti ';
    //   const authInfo = await authenticate(ctx, {
    //     ...DEFAULT_INFO,
    //     route: 'config',
    //     org: 'testorg',
    //     site: 'site',
    //     headers: {
    //       authorization: `token ${accessToken}`,
    //     },
    //   });
    //   delete authInfo.profile?.exp;
    //   delete authInfo.profile?.iat;
    //   delete authInfo.profile?.ttl;
    //   assert.strictEqual(authInfo.authenticated, true);
    //   assert.strictEqual(authInfo.hasPermissions('config:write'), true);
    // });
  });
});

describe('IMS Authentication Test', () => {
  const DEFAULT_INFO = {
    owner: 'owner',
    repo: 'repo',
    ref: 'ref',
    path: '/',
    resourcePath: '/index.md',
    headers: {},
    query: {},
    scheme: 'https',
    host: 'admin.hlx.page',
    functionPath: '',
  };

  let nock;
  let privateKey;

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

    const authInfo = await authenticate(DEFAULT_CONTEXT({
      attributes: {
        configAll: {
          config: {
            data: {
              admin: {
                role: {
                  publish: 'helix@adobe.com',
                },
              },
            },
          },
        },
      },
    }), {
      ...DEFAULT_INFO,
      headers: {
        authorization: `bearer ${accessToken}`,
      },
    });
    delete authInfo.profile?.ttl;
    delete authInfo.profile?.created_at;

    return { authInfo, accessToken };
  }

  it('supports the ims backend token (stage)', async () => {
    const { authInfo, accessToken } = await testIMSToken();
    assert.deepStrictEqual(authInfo.profile, {
      as: 'ims-na1-stg1',
      client_id: 'foobar-client',
      email: 'helix@adobe.com',
      expires_in: '86400000',
      defaultRole: 'publish',
      scope: 'aem.backend.all,openid,AdobeID',
    });
    assert.strictEqual(authInfo.imsToken, accessToken);
  });

  it('supports the ims backend token with user defined roles (stage)', async () => {
    const { authInfo, accessToken } = await testIMSToken({
      roles: ['developer'],
    });
    assert.deepStrictEqual(authInfo.profile, {
      as: 'ims-na1-stg1',
      client_id: 'foobar-client',
      email: 'helix@adobe.com',
      expires_in: '86400000',
      roles: ['developer'],
      defaultRole: 'publish',
      scope: 'aem.backend.all,openid,AdobeID',
    });
    assert.strictEqual(authInfo.imsToken, accessToken);
  });

  it('supports the ims frontend token (stage)', async () => {
    const { authInfo, accessToken } = await testIMSToken({
      scope: 'aem.frontend.all,openid,AdobeID',
    });
    assert.deepStrictEqual(authInfo.profile, {
      as: 'ims-na1-stg1',
      client_id: 'foobar-client',
      email: 'helix@adobe.com',
      expires_in: '86400000',
      scope: 'aem.frontend.all,openid,AdobeID',
    });
    assert.strictEqual(authInfo.imsToken, accessToken);
  });

  it('supports the ims cm-repo-service token (stage)', async () => {
    const { authInfo } = await testIMSToken({
      scope: 'read_pc.dma_tartan,system,read_pc.dma_aem_ams,openid,AdobeID,additional_info.projectedProductContext,acp.core.pipeline',
      client_id: 'cm-repo-service',
    });
    assert.deepStrictEqual(authInfo.profile, {
      as: 'ims-na1-stg1',
      client_id: 'cm-repo-service',
      email: 'helix@adobe.com',
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

describe('Authorization Test', () => {
  const DEFAULT_INFO = {
    owner: 'owner',
    repo: 'repo',
    ref: 'ref',
    path: '/',
    resourcePath: '/index.md',
    headers: {},
  };

  const CONFIG_NO_ROLES = {
    data: [{
      key: 'admin.secure',
      value: 'true',
    }],
  };

  const CONFIG_PUBLISH_BOB = {
    data: [{
      key: 'admin.role.publish',
      value: 'bob',
    }],
  };

  const CONFIG_PUBLISH_BOB_NOT_REQUIRED = {
    data: [{
      key: 'admin.role.publish',
      value: 'bob',
    }, {
      key: 'admin.requireAuth',
      value: 'false',
    }],
  };

  const CONFIG_AUTH_REQUIRED = {
    data: [{
      key: 'admin.requireAuth',
      value: 'true',
    }],
  };

  const CONFIG_PUBLISH_ALICE = {
    data: [{
      key: 'admin.role.superuser',
      value: 'alice',
    }],
  };

  const CONFIG_DEFAULT_ROLE = {
    data: [{
      key: 'admin.defaultRole',
      value: 'publish',
    }],
  };

  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('uses anonymous default roles with no config', async () => {
    const authInfo = AuthInfo.Default();
    nock.projectConfig('foo-id', CONFIG_NO_ROLES);
    await authorize(
      DEFAULT_CONTEXT({
        attributes: {
          configAll: undefined,
          contentBusId: 'foo-id',
          authInfo,
        },
      }),
      DEFAULT_INFO,
    );
    assert.deepStrictEqual(authInfo.toJSON(), {
      expired: false,
      loginHint: null,
      profile: null,
      idp: undefined,
      authenticated: false,
      roles: [
        'basic_publish',
      ],
      permissions: [
        ...PERMISSIONS.basic_publish,
      ],
    });
  });

  it('uses provided default roles for authenticated users with no config', async () => {
    const authInfo = AuthInfo.Default().withProfile({ defaultRole: 'publish' });
    nock.projectConfig('foo-id', CONFIG_NO_ROLES);
    await authorize(
      DEFAULT_CONTEXT({
        attributes: {
          configAll: undefined,
          contentBusId: 'foo-id',
          authInfo,
        },
      }),
      DEFAULT_INFO,
    );
    assert.deepStrictEqual(authInfo.toJSON(), {
      expired: false,
      loginHint: null,
      profile: {
        defaultRole: 'publish',
      },
      idp: undefined,
      authenticated: false,
      roles: [
        'publish',
      ],
      permissions: [
        ...PERMISSIONS.publish,
      ],
    });
  });

  it('rejects missing auth info', async () => {
    await assert.rejects(authorize(DEFAULT_CONTEXT(), {
      ...DEFAULT_INFO,
    }), new AccessDeniedError('not authenticated'));
  });

  it('populates the user roles', async () => {
    nock.projectConfig('foo-id', CONFIG_PUBLISH_BOB);
    const authInfo = AuthInfo.Default()
      .withAuthenticated(true)
      .withProfile({
        email: 'bob',
      });

    await authorize(
      DEFAULT_CONTEXT({ attributes: { authInfo, configAll: undefined, contentBusId: 'foo-id' } }),
      { ...DEFAULT_INFO },
    );
    assert.deepStrictEqual(authInfo.toJSON().roles, ['publish']);
  });

  it('populates the user roles from user_id', async () => {
    nock.projectConfig('foo-id', CONFIG_PUBLISH_BOB);
    const authInfo = AuthInfo.Default()
      .withAuthenticated(true)
      .withProfile({
        user_id: 'bob',
      });

    await authorize(
      DEFAULT_CONTEXT({ attributes: { authInfo, configAll: undefined, contentBusId: 'foo-id' } }),
      { ...DEFAULT_INFO },
    );
    assert.deepStrictEqual(authInfo.toJSON().roles, ['publish']);
  });

  it('populates the user roles from preferred_username', async () => {
    nock.projectConfig('foo-id', CONFIG_PUBLISH_BOB);
    const authInfo = AuthInfo.Default()
      .withAuthenticated(true)
      .withProfile({
        preferred_username: 'bob',
      });

    await authorize(
      DEFAULT_CONTEXT({ attributes: { authInfo, configAll: undefined, contentBusId: 'foo-id' } }),
      { ...DEFAULT_INFO },
    );
    assert.deepStrictEqual(authInfo.toJSON().roles, ['publish']);
  });

  it('rejects secured config with no authentication', async () => {
    nock.projectConfig('foo-id', CONFIG_PUBLISH_BOB);
    const authInfo = AuthInfo.Default();
    await assert.rejects(
      authorize(
        DEFAULT_CONTEXT({ attributes: { authInfo, configAll: undefined, contentBusId: 'foo-id' } }),
        { ...DEFAULT_INFO },
      ),
      new AccessDeniedError('not authenticated'),
    );
  });

  it('enforce secured config with no roles', async () => {
    nock.projectConfig('foo-id', CONFIG_AUTH_REQUIRED);
    const authInfo = AuthInfo.Default();
    await assert.rejects(
      authorize(
        DEFAULT_CONTEXT({ attributes: { authInfo, configAll: undefined, contentBusId: 'foo-id' } }),
        { ...DEFAULT_INFO },
      ),
      new AccessDeniedError('not authenticated'),
    );
  });

  it('allows secured config with no authentication if configured', async () => {
    nock.projectConfig('foo-id', CONFIG_PUBLISH_BOB_NOT_REQUIRED);
    const authInfo = AuthInfo.Default();
    await authorize(
      DEFAULT_CONTEXT({ attributes: { authInfo, configAll: undefined, contentBusId: 'foo-id' } }),
      { ...DEFAULT_INFO },
    );
    assert.deepStrictEqual(authInfo.toJSON().roles, ['basic_publish']);
  });

  it('ignores user with no matching roles', async () => {
    nock.projectConfig('foo-id', CONFIG_PUBLISH_BOB);

    const authInfo = AuthInfo.Default()
      .withAuthenticated(true)
      .withProfile({
        email: 'alice',
      });

    await authorize(
      DEFAULT_CONTEXT({ attributes: { authInfo, configAll: undefined, contentBusId: 'foo-id' } }),
      { ...DEFAULT_INFO },
    );
    assert.deepStrictEqual(authInfo.toJSON().roles, []);
  });

  it('ignores invalid role in config', async () => {
    nock.projectConfig('foo-id', CONFIG_PUBLISH_ALICE);
    const authInfo = AuthInfo.Default()
      .withAuthenticated(true)
      .withProfile({
        email: 'alice',
      });

    await authorize(
      DEFAULT_CONTEXT({ attributes: { authInfo, configAll: undefined, contentBusId: 'foo-id' } }),
      { ...DEFAULT_INFO },
    );
    assert.deepStrictEqual(authInfo.toJSON().roles, []);
  });

  it('allows to configure the default role', async () => {
    nock.projectConfig('foo-id', CONFIG_DEFAULT_ROLE);
    const authInfo = AuthInfo.Default();
    await authorize(
      DEFAULT_CONTEXT({ attributes: { authInfo, configAll: undefined, contentBusId: 'foo-id' } }),
      { ...DEFAULT_INFO },
    );
    assert.deepStrictEqual(authInfo.toJSON().roles, ['publish']);
  });
});

describe('AuthInfo Test', () => {
  it('auth info can assert for permissions', async () => {
    const authInfo = new AuthInfo()
      .withRole('publish');
    authInfo.assertPermissions('live:read');
    assert.throws(() => authInfo.assertPermissions('system:exit'), new AccessDeniedError('system:exit'));

    authInfo.assertAnyPermission('live:read', 'system:exit');
    assert.throws(() => authInfo.assertAnyPermission('system:exit', 'config:read'), new AccessDeniedError('system:exit or config:read'));
  });

  it('auth info can filter permissions', async () => {
    const authInfo = new AuthInfo()
      .withRole('admin');
    assert.deepStrictEqual(authInfo.getPermissions('live:'), ['delete', 'delete-forced', 'list', 'read', 'write']);
  });

  it('auth info can remove permissions', async () => {
    const authInfo = new AuthInfo()
      .withRole('publish')
      .removePermissions('live:read', 'preview:read');

    assert.deepStrictEqual(authInfo.getPermissions(), [
      'cache:write',
      'code:delete',
      'code:read',
      'code:write',
      'cron:read',
      'cron:write',
      'discover:peek',
      'edit:list',
      'edit:read',
      'index:read',
      'index:write',
      'job:list',
      'job:read',
      'job:write',
      'live:delete',
      'live:delete-forced',
      'live:list',
      'live:write',
      'log:read',
      'preview:delete',
      'preview:delete-forced',
      'preview:list',
      'preview:write',
      'snapshot:delete',
      'snapshot:read',
      'snapshot:write',
    ]);
  });
});

describe('Site Auth Test', () => {
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('creates a valid site auth token', async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    const publicJwk = await exportJWK(keyPair.publicKey);
    Object.assign(jwks.keys[0], publicJwk);
    const ctx = DEFAULT_CONTEXT({
      env: {
        HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(await exportJWK(keyPair.privateKey)),
        HLX_SITE_APP_AZURE_CLIENT_ID: 'dummy-clientid',
      },
      attributes: {
        configAll: {
          config: {
            data: {
              access: {
                allow: '*@adobe.com',
              },
            },
          },
        },
      },
    });
    const token = await getSiteAuthToken(ctx, { partition: 'live' });
    const localJWKS = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(token, localJWKS, {
      audience: 'dummy-clientid',
    });
    assert.strictEqual(payload.email, 'helix@adobe.com');
    // check if token is cached
    assert.strictEqual(ctx.attributes.accessConfig.live.token, token);
  });

  it('creates a valid helix 4 site auth token', async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    const publicJwk = await exportJWK(keyPair.publicKey);
    Object.assign(jwks.keys[0], publicJwk);
    const ctx = DEFAULT_CONTEXT({
      env: {
        HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(await exportJWK(keyPair.privateKey)),
        HLX_SITE_APP_AZURE_CLIENT_ID: 'dummy-clientid',
      },
      attributes: {
        configAll: {
          config: {
            data: {
              access: {
                allow: '*@adobe.com',
              },
            },
          },
        },
      },
    });
    const token = await getHelix4SiteAuthToken(ctx, { partition: 'live' });
    const localJWKS = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(token, localJWKS, {
      audience: 'dummy-clientid',
    });
    assert.strictEqual(payload.email, 'helix@adobe.com');
    // check if token is cached
    assert.strictEqual(ctx.attributes.accessConfig.live.token, token);
  });

  it('creates a valid site auth token (helix5)', async () => {
    const ctx = DEFAULT_CONTEXT({
      env: {
        HLX_GLOBAL_DELIVERY_TOKEN: 'hlx_example-token',
      },
      attributes: {
        configAll: {
          config: {
            data: {
              access: {
                apiKeyId: '1234',
              },
            },
          },
        },
        config: {
          access: {
            live: {
              apiKeyId: '1234',
            },
          },
        },
      },
    });
    const token = await getSiteAuthToken(ctx, { partition: 'live' });
    assert.strictEqual(token, 'hlx_example-token');
    // check if token is cached
    assert.strictEqual(ctx.attributes.accessConfig.live.token, token);
  });

  it('creates a valid helix 4 site auth token if both helix 4 and 5 configs present', async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    const publicJwk = await exportJWK(keyPair.publicKey);
    Object.assign(jwks.keys[0], publicJwk);
    const ctx = DEFAULT_CONTEXT({
      env: {
        HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(await exportJWK(keyPair.privateKey)),
        HLX_SITE_APP_AZURE_CLIENT_ID: 'dummy-clientid',
        HLX_GLOBAL_DELIVERY_TOKEN: 'hlx_example-token',
      },
      attributes: {
        configAll: {
          config: {
            data: {
              access: {
                apiKeyId: '1234',
              },
            },
          },
        },
        config: {
          access: {
            live: {
              apiKeyId: '1234',
            },
          },
        },
      },
    });
    const token = await getHelix4SiteAuthToken(ctx, { partition: 'live' });
    const localJWKS = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(token, localJWKS, {
      audience: 'dummy-clientid',
    });
    assert.strictEqual(payload.email, 'helix@adobe.com');
    // check if token is cached
    assert.strictEqual(ctx.attributes.accessConfig.live.token, token);
  });

  it('returns null if site not access control enabled', async () => {
    const ctx = DEFAULT_CONTEXT();
    const token = await getSiteAuthToken(ctx, {});
    assert.strictEqual(token, null);
  });

  it('returns null if site not access control enabled (helix 4 only)', async () => {
    const ctx = DEFAULT_CONTEXT();
    const token = await getHelix4SiteAuthToken(ctx, { partition: 'preview' });
    assert.strictEqual(token, null);
  });

  it('returns a cached access token', async () => {
    const ctx = DEFAULT_CONTEXT({
      attributes: {
        accessConfig: {
          preview: {
            allow: '*@adobe.com',
            token: 'foo',
          },
        },
      },
    });
    const token = await getSiteAuthToken(ctx, { partition: 'preview' });
    assert.strictEqual(token, 'foo');
  });
});

describe('Site Access config tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('returns empty access config', async () => {
    assert.deepStrictEqual(await getSiteAccessConfig(DEFAULT_CONTEXT(), { partition: 'preview' }), {
      allow: [],
      apiKeyId: [],
      secretId: [],
    });
  });

  it('returns default access config', async () => {
    const ctx = DEFAULT_CONTEXT();
    ctx.attributes.configAll = {
      config: {
        data: {
          access: {
            allow: '*@adobe.com',
          },
        },
      },
    };
    assert.deepStrictEqual(await getSiteAccessConfig(ctx, { partition: 'preview' }), {
      allow: ['*@adobe.com'],
      apiKeyId: [],
      secretId: [],
    });
  });

  it('can partially overwrite access config', async () => {
    const ctx = DEFAULT_CONTEXT();
    ctx.attributes.configAll = {
      config: {
        data: {
          access: {
            allow: '*@adobe.com',
            apiKeyId: '1234',
            live: {
              allow: ['foo@adobe.com', 'bar@adobe.com'],
              secretId: ['abcd'],
            },
          },
        },
      },
    };
    assert.deepStrictEqual(await getSiteAccessConfig(ctx, { partition: 'live' }), {
      allow: ['foo@adobe.com', 'bar@adobe.com'],
      apiKeyId: ['1234'],
      secretId: ['abcd'],
    });
  });
});

describe('Transient Site Token Test', () => {
  let publicJwk;
  let privateJwk;
  let localJWKS;

  before(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    publicJwk = await exportJWK(keyPair.publicKey);
    privateJwk = await exportJWK(keyPair.privateKey);
    localJWKS = createLocalJWKSet({
      keys: [publicJwk],
    });
  });

  let nock;
  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('returns null for transient site token if not protected', async () => {
    nock.config({
      ...SITE_CONFIG,
      access: {
        preview: {
          apiKeyId: [],
        },
      },
    }, 'owner', 'repo', 'main');
    const info = {
      org: 'owner',
      site: 'repo',
    };
    assert.strictEqual(await getTransientSiteTokenInfo(DEFAULT_CONTEXT(), info, 'test@example.com'), null);
  });

  it('returns null for transient site token if not protected helix 5 site for helix@adobe.com', async () => {
    nock.config({
      ...SITE_CONFIG,
      access: {
        preview: {
          apiKeyId: [],
        },
      },
    }, 'owner', 'repo', 'main');

    const info = {
      org: 'owner',
      site: 'repo',
    };
    assert.strictEqual(await getTransientSiteTokenInfo(DEFAULT_CONTEXT(), info, 'helix@adobe.com'), null);
  });

  it('returns null for transient site token if not protected helix 4 site for helix@adobe.com', async () => {
    nock.config(null, 'owner', 'repo', 'main');

    const ctx = DEFAULT_CONTEXT({
      attributes: {
        configAll: {
          config: {
            data: {
              access: {
              },
            },
          },
        },
      },
    });

    const info = {
      org: 'owner',
      site: 'repo',
    };
    assert.strictEqual(await getTransientSiteTokenInfo(ctx, info, 'helix@adobe.com'), null);
  });

  it('returns transient preview site token if access.allowed', async () => {
    nock.config({
      ...SITE_CONFIG,
      access: {
        preview: {
          allow: ['test@example.com'],
        },
        live: {
          allow: ['*@example.com'],
        },
      },
    }, 'owner', 'repo', 'main');
    const info = {
      org: 'owner',
      site: 'repo',
    };
    const ctx = DEFAULT_CONTEXT({
      env: {
        HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(privateJwk),
      },
    });
    const ret = await getTransientSiteTokenInfo(ctx, info, 'test@example.com');
    assert.ok(ret.siteToken.startsWith('hlxtst_'));
    const jwt = await jwtVerify(ret.siteToken.substring(7), localJWKS);
    assert.strictEqual(jwt.payload.aud, 'repo--owner.aem.page');
    assert.strictEqual(jwt.payload.sub, 'test@example.com');
    assert.strictEqual(jwt.payload.exp, Math.floor(ret.siteTokenExpiry / 1000));
  });

  it('returns transient preview site token for helix@adobe.com if access is enabled in preview in helix 5', async () => {
    const OneHour = 1 * 60 * 60 * 1000;
    const FiveSeconds = 5 * 1000;
    nock.config({
      ...SITE_CONFIG,
      access: {
        preview: {
          allow: ['test@example.com'],
        },
        live: {
          allow: ['*@example.com'],
        },
      },
    }, 'owner', 'repo', 'main');
    const info = {
      org: 'owner',
      site: 'repo',
    };
    const ctx = DEFAULT_CONTEXT({
      env: {
        HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(privateJwk),
      },
    });
    const ret = await getTransientSiteTokenInfo(ctx, info, 'helix@adobe.com', OneHour);
    assert.ok(ret.siteToken.startsWith('hlxtst_'));
    const jwt = await jwtVerify(ret.siteToken.substring(7), localJWKS);
    assert.strictEqual(jwt.payload.aud, 'repo--owner.aem.page');
    assert.strictEqual(jwt.payload.sub, 'helix@adobe.com');
    assert.ok(Math.abs(ret.siteTokenExpiry - (Date.now() + OneHour)) < FiveSeconds);
  });

  it('returns transient live site token if access.allowed', async () => {
    nock.config({
      ...SITE_CONFIG,
      access: {
        preview: {
          allow: ['test@example.com'],
        },
        live: {
          allow: ['*@example.com'],
        },
      },
    }, 'owner', 'repo', 'main');
    const info = {
      org: 'owner',
      site: 'repo',
    };
    const ctx = DEFAULT_CONTEXT({
      env: {
        HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(privateJwk),
      },
    });
    const ret = await getTransientSiteTokenInfo(ctx, info, 'bob@example.com');
    assert.ok(ret.siteToken.startsWith('hlxtst_'));
    const jwt = await jwtVerify(ret.siteToken.substring(7), localJWKS);
    assert.strictEqual(jwt.payload.aud, 'repo--owner.aem.live');
    assert.strictEqual(jwt.payload.sub, 'bob@example.com');
    assert.strictEqual(jwt.payload.exp, Math.floor(ret.siteTokenExpiry / 1000));
  });

  it('returns transient preview site token for helix@adobe.com if access is enabled in live in helix 5', async () => {
    const OneHour = 1 * 60 * 60 * 1000;
    const FiveSeconds = 5 * 1000;
    nock.config({
      ...SITE_CONFIG,
      access: {
        preview: {
          allow: ['test@example.com'],
        },
        live: {
          allow: ['*@example.com'],
        },
      },
    }, 'owner', 'repo', 'main');
    const info = {
      org: 'owner',
      site: 'repo',
    };
    const ctx = DEFAULT_CONTEXT({
      env: {
        HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(privateJwk),
      },
    });
    const ret = await getTransientSiteTokenInfo(ctx, info, 'helix@adobe.com', OneHour);
    assert.ok(ret.siteToken.startsWith('hlxtst_'));
    const jwt = await jwtVerify(ret.siteToken.substring(7), localJWKS);
    assert.strictEqual(jwt.payload.aud, 'repo--owner.aem.page');
    assert.strictEqual(jwt.payload.sub, 'helix@adobe.com');
    assert.ok(Math.abs(ret.siteTokenExpiry - (Date.now() + OneHour)) < FiveSeconds);
  });

  it('returns null for transient site token if not authorized', async () => {
    nock.config({
      ...SITE_CONFIG,
      access: {
        preview: {
          apiKeyId: ['admin'],
        },
        admin: {
          role: {
            publish: ['foo@example.com'],
          },
        },
      },
    }, 'owner', 'repo', 'main');
    const info = {
      org: 'owner',
      site: 'repo',
    };
    assert.strictEqual(await getTransientSiteTokenInfo(DEFAULT_CONTEXT(), info, 'test@example.com'), null);
  });

  it('returns null if there is an error during role resolution', async () => {
    nock.config({
      ...SITE_CONFIG,
      access: {
        preview: {
          apiKeyId: ['admin'],
        },
        admin: {
          role: {
            publish: ['foo.json'],
          },
        },
      },
    }, 'owner', 'repo', 'main');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/foo.json?x-id=GetObject')
      .reply(404);
    const info = {
      org: 'owner',
      site: 'repo',
    };
    assert.strictEqual(await getTransientSiteTokenInfo(DEFAULT_CONTEXT({
      attributes: {
        contentBusId: undefined,
      },
    }), info, 'test@example.com'), null);
  });

  it('returns null if there is an exception during role resolution', async () => {
    nock.config({
      ...SITE_CONFIG,
      access: {
        preview: {
          apiKeyId: ['admin'],
        },
        admin: {
          role: {
            publish: ['foo.json'],
          },
        },
      },
    }, 'owner', 'repo', 'main');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/foo.json?x-id=GetObject')
      .reply(401);
    const info = {
      org: 'owner',
      site: 'repo',
    };
    assert.strictEqual(await getTransientSiteTokenInfo(DEFAULT_CONTEXT({
      attributes: {
        contentBusId: undefined,
      },
    }), info, 'test@example.com'), null);
  });

  it('returns transient preview site token if access is enabled in helix 4', async () => {
    const OneHour = 1 * 60 * 60 * 1000;
    const FiveSeconds = 5 * 1000;
    nock.config(null, 'owner', 'repo', 'main');

    const ctx = DEFAULT_CONTEXT({
      env: {
        HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(privateJwk),
      },
      attributes: {
        configAll: {
          config: {
            data: {
              access: {
                allow: '*@example.com',
              },
            },
          },
        },
      },
    });

    const info = {
      org: 'owner',
      site: 'repo',
    };

    const ret = await getTransientSiteTokenInfo(ctx, info, 'test@example.com', OneHour);
    assert.ok(ret.siteToken.startsWith('hlxtst_'));
    const jwt = await jwtVerify(ret.siteToken.substring(7), localJWKS);
    assert.strictEqual(jwt.payload.aud, 'repo--owner.aem.page');
    assert.strictEqual(jwt.payload.sub, 'test@example.com');
    assert.strictEqual(jwt.payload.exp, Math.floor(ret.siteTokenExpiry / 1000));
    assert.ok(Math.abs(ret.siteTokenExpiry - (Date.now() + OneHour)) < FiveSeconds);
  });

  it('returns transient preview site token for helix@adobe.com if access is enabled in helix 4', async () => {
    const OneHour = 1 * 60 * 60 * 1000;
    const FiveSeconds = 5 * 1000;
    nock.config(null, 'owner', 'repo', 'main');

    const ctx = DEFAULT_CONTEXT({
      env: {
        HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(privateJwk),
      },
      attributes: {
        configAll: {
          config: {
            data: {
              access: {
                allow: '*@example.com',
              },
            },
          },
        },
      },
    });

    const info = {
      org: 'owner',
      site: 'repo',
    };

    const ret = await getTransientSiteTokenInfo(ctx, info, 'helix@adobe.com', OneHour);
    assert.ok(ret.siteToken.startsWith('hlxtst_'));
    const jwt = await jwtVerify(ret.siteToken.substring(7), localJWKS);
    assert.strictEqual(jwt.payload.aud, 'repo--owner.aem.page');
    assert.strictEqual(jwt.payload.sub, 'helix@adobe.com');
    assert.strictEqual(jwt.payload.exp, Math.floor(ret.siteTokenExpiry / 1000));
    assert.ok(Math.abs(ret.siteTokenExpiry - (Date.now() + OneHour)) < FiveSeconds);
  });
});
