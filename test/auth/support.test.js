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
  jwtVerify,
} from 'jose';
import { getSiteAuthToken, getTransientSiteTokenInfo } from '../../src/auth/support.js';
import jwks from '../../src/idp-configs/jwks-json.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

describe('Support Test', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  const suffix = '/org/sites/site/status/';

  function setupTest({ access, attributes, env } = {}) {
    const context = createContext(suffix, {
      attributes: {
        config: {
          ...SITE_CONFIG,
          access,
        },
        ...attributes,
      },
      env,
    });
    const info = createInfo(suffix).withCode('owner', 'repo');
    return { context, info };
  }

  describe('Site Auth Test', () => {
    it.skip('creates a valid site auth token (helix 4)', async () => {
      const keyPair = await generateKeyPair('RS256', { extractable: true });
      const publicJwk = await exportJWK(keyPair.publicKey);
      Object.assign(jwks.keys[0], publicJwk);

      const { context } = setupTest({
        access: {
          allow: '*@adobe.com',
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(await exportJWK(keyPair.privateKey)),
          HLX_SITE_APP_AZURE_CLIENT_ID: 'dummy-clientid',
        },
      });

      const token = await getSiteAuthToken(context, 'live');
      const localJWKS = createLocalJWKSet(jwks);
      const { payload } = await jwtVerify(token, localJWKS, {
        audience: 'dummy-clientid',
      });
      assert.strictEqual(payload.email, 'helix@adobe.com');
      // check if token is cached
      assert.strictEqual(context.attributes.accessConfig.live.token, token);
    });

    it('creates a valid site auth token', async () => {
      const { context } = setupTest({
        access: {
          apiKeyId: '1234',
          live: {
            apiKeyId: '1234',
          },
        },
        env: {
          HLX_GLOBAL_DELIVERY_TOKEN: 'hlx_example-token',
        },
      });

      const token = await getSiteAuthToken(context, 'live');

      assert.strictEqual(token, 'hlx_example-token');
      // check if token is cached
      assert.strictEqual(context.attributes.accessConfig.live.token, token);
    });

    it('returns null if site not access control enabled', async () => {
      const { context } = setupTest();
      const token = await getSiteAuthToken(context, {});
      assert.strictEqual(token, null);
    });

    it('returns a cached access token', async () => {
      const { context } = setupTest({
        attributes: {
          accessConfig: {
            preview: {
              allow: '*@adobe.com',
              token: 'foo',
            },
          },
        },
      });
      const token = await getSiteAuthToken(context, 'preview');
      assert.strictEqual(token, 'foo');
    });
  });

  describe('Site Access config tests', () => {
    it('returns empty access config', async () => {
      const { context } = setupTest();

      assert.deepStrictEqual(await context.getSiteAccessConfig('preview'), {
        allow: [],
        apiKeyId: [],
        secretId: [],
      });
    });

    it('returns default access config', async () => {
      const { context } = setupTest({
        access: {
          allow: '*@adobe.com',
        },
      });
      assert.deepStrictEqual(await context.getSiteAccessConfig('preview'), {
        allow: ['*@adobe.com'],
        apiKeyId: [],
        secretId: [],
      });
    });

    it('can partially overwrite access config', async () => {
      const { context } = setupTest({
        access: {
          allow: '*@adobe.com',
          apiKeyId: '1234',
          live: {
            allow: ['foo@adobe.com', 'bar@adobe.com'],
            secretId: ['abcd'],
          },
        },
      });
      assert.deepStrictEqual(await context.getSiteAccessConfig('live'), {
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

    it('returns null for transient site token if not protected', async () => {
      const { context, info } = setupTest({
        access: {
          preview: {
            apiKeyId: [],
          },
        },
      });

      assert.strictEqual(await getTransientSiteTokenInfo(context, info, 'test@example.com'), null);
    });

    it('returns null for transient site token if not protected helix 5 site for helix@adobe.com', async () => {
      const { context, info } = setupTest({
        access: {
          preview: {
            apiKeyId: [],
          },
        },
      });

      assert.strictEqual(await getTransientSiteTokenInfo(context, info, 'helix@adobe.com'), null);
    });

    it('returns transient preview site token if access.allowed', async () => {
      const { context, info } = setupTest({
        access: {
          preview: {
            allow: ['test@example.com'],
          },
          live: {
            allow: ['*@example.com'],
          },
        },
        env: {
          HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });

      const ret = await getTransientSiteTokenInfo(context, info, 'test@example.com');
      assert.ok(ret.siteToken.startsWith('hlxtst_'));
      const jwt = await jwtVerify(ret.siteToken.substring(7), localJWKS);
      assert.strictEqual(jwt.payload.aud, 'site--org.aem.page');
      assert.strictEqual(jwt.payload.sub, 'test@example.com');
      assert.strictEqual(jwt.payload.exp, Math.floor(ret.siteTokenExpiry / 1000));
    });

    it('returns transient preview site token for helix@adobe.com if access is enabled in preview in helix 5', async () => {
      const OneHour = 1 * 60 * 60 * 1000;
      const FiveSeconds = 5 * 1000;

      const { context, info } = setupTest({
        access: {
          preview: {
            allow: ['test@example.com'],
          },
          live: {
            allow: ['*@example.com'],
          },
        },
        env: {
          HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });

      const ret = await getTransientSiteTokenInfo(context, info, 'helix@adobe.com', OneHour);
      assert.ok(ret.siteToken.startsWith('hlxtst_'));
      const jwt = await jwtVerify(ret.siteToken.substring(7), localJWKS);
      assert.strictEqual(jwt.payload.aud, 'site--org.aem.page');
      assert.strictEqual(jwt.payload.sub, 'helix@adobe.com');
      assert.ok(Math.abs(ret.siteTokenExpiry - (Date.now() + OneHour)) < FiveSeconds);
    });

    it('returns transient live site token if access.allowed', async () => {
      const { context, info } = setupTest({
        access: {
          preview: {
            allow: ['test@example.com'],
          },
          live: {
            allow: ['*@example.com'],
          },
        },
        env: {
          HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });

      const ret = await getTransientSiteTokenInfo(context, info, 'bob@example.com');
      assert.ok(ret.siteToken.startsWith('hlxtst_'));
      const jwt = await jwtVerify(ret.siteToken.substring(7), localJWKS);
      assert.strictEqual(jwt.payload.aud, 'site--org.aem.live');
      assert.strictEqual(jwt.payload.sub, 'bob@example.com');
      assert.strictEqual(jwt.payload.exp, Math.floor(ret.siteTokenExpiry / 1000));
    });

    it('returns transient preview site token for helix@adobe.com if access is enabled in live in helix 5', async () => {
      const OneHour = 1 * 60 * 60 * 1000;
      const FiveSeconds = 5 * 1000;

      const { context, info } = setupTest({
        access: {
          preview: {
            allow: ['test@example.com'],
          },
          live: {
            allow: ['*@example.com'],
          },
        },
        env: {
          HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });

      const ret = await getTransientSiteTokenInfo(context, info, 'helix@adobe.com', OneHour);
      assert.ok(ret.siteToken.startsWith('hlxtst_'));
      const jwt = await jwtVerify(ret.siteToken.substring(7), localJWKS);
      assert.strictEqual(jwt.payload.aud, 'site--org.aem.page');
      assert.strictEqual(jwt.payload.sub, 'helix@adobe.com');
      assert.ok(Math.abs(ret.siteTokenExpiry - (Date.now() + OneHour)) < FiveSeconds);
    });

    it('returns null for transient site token if not authorized', async () => {
      const { context, info } = setupTest({
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
      });
      assert.strictEqual(await getTransientSiteTokenInfo(context, info, 'test@example.com'), null);
    });

    it.skip('returns null if there is an error during role resolution', async () => {
      nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
        .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/foo.json?x-id=GetObject')
        .reply(404);

      const { context, info } = setupTest({
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
      });
      assert.strictEqual(await getTransientSiteTokenInfo(context, info, 'test@example.com'), null);
    });

    it.skip('returns null if there is an exception during role resolution', async () => {
      nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
        .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/preview/.helix/foo.json?x-id=GetObject')
        .reply(401);

      const { context, info } = setupTest({
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
      });
      assert.strictEqual(await getTransientSiteTokenInfo(context, info, 'test@example.com'), null);
    });
  });
});
