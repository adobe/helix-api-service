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
import { AccessDeniedError } from '../../src/auth/AccessDeniedError.js';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import {
  SIDEKICK_CSRF_PROTECTION_CONFIG,
  sidekickCSRFProtection,
  TRUSTED_ORIGINS,
} from '../../src/sidekick/csrf.js';
import {
  createContext, createInfo, Nock, ORG_CONFIG, SITE_CONFIG,
} from '../utils.js';

describe('Sidekick CSRF Protection', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  const TEST_CONFIG = {
    ...SITE_CONFIG,
    limits: {
      admin: {
        trustedHosts: [
          // valid patterns
          'sidekickextension.com',
          '*.extension.com',
          '*--site--owner2.hlx.page', // spefic site from another org
          '*--*--owner3.hlx.page', // any site from another specific org
          // invalid patterns should be ignored
          null, // invalid
          undefined, // invalid
          3, // invalid
          '', // invalid
          'evil.*', // too permissive
          '*.com', // too permissive
          '*', // too permissive
          'test..com', // double dot
          '**.evil.com', // globbing one after the other
          '*--*--*.aem.live', // too many globbing characters
          `https://${'a'.repeat(253)}.com`, // too long
        ],
      },
    },
    cdn: {
      prod: {
        host: 'host.prod',
        route: ['/en'],
      },
      preview: {
        host: 'host.preview',
      },
      live: {
        host: 'host.live',
      },
    },
    sidekick: {
      plugins: [],
    },
  };

  before(() => {
    SIDEKICK_CSRF_PROTECTION_CONFIG.exceptedOrgs.push('org2');
  });

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  describe('E2E', () => {
    function setupTest({ suffix = '/org/sites/site/live/', headers = {} } = {}) {
      const request = new Request(`https://api.aem.live${suffix}`, {
        headers: {
          'x-request-id': 'rid',
          ...headers,
        },
      });
      const context = {
        pathInfo: { suffix },
        attributes: {
          authInfo: AuthInfo.Default()
            .withProfile({
              email: 'bob@example.com',
            })
            .withPermissions(['code:read'])
            .withExtensionId('1234')
            .withAuthenticated(true),
        },
        env: {
          HLX_CONFIG_SERVICE_TOKEN: 'token',
          HELIX_STORAGE_MAX_ATTEMPTS: '1',
        },
      };
      return { request, context };
    }

    describe('Untrusted origins E2E', () => {
      const originalKillSwitch = SIDEKICK_CSRF_PROTECTION_CONFIG.enabled;

      before(() => {
        SIDEKICK_CSRF_PROTECTION_CONFIG.enabled = true;
      });

      after(() => {
        SIDEKICK_CSRF_PROTECTION_CONFIG.enabled = originalKillSwitch;
      });

      it('Missing Origin for sidekick authenticated request', async () => {
        nock.siteConfig(TEST_CONFIG);

        const { request, context } = setupTest({ headers: { 'sec-fetch-mode': 'no-cors' } });
        const result = await main(request, context);

        assert.strictEqual(result.status, 403);
      });

      it('Untrusted origin for a site', async () => {
        nock.siteConfig(TEST_CONFIG);

        const { request, context } = setupTest({ headers: { origin: 'https://evil.com' } });
        const result = await main(request, context);

        assert.strictEqual(result.status, 403);
      });

      it('Untrusted origin for a org', async () => {
        nock.orgConfig(ORG_CONFIG);

        const { request, context } = setupTest({
          suffix: '/org/config',
          headers: { origin: 'https://evil.com' },
        });
        const result = await main(request, context);

        assert.strictEqual(result.status, 403);
      });

      it('Untrusted origin for top level', async () => {
        const { request, context } = setupTest({
          suffix: '/profile',
          headers: { origin: 'https://evil.com' },
        });
        const result = await main(request, context);

        assert.strictEqual(result.status, 403);
      });

      it.skip('Untrusted origin for org that is opt-out', async () => {
        // TODO: profile no longer allows org or site path parameter
        const { request, context } = setupTest({
          suffix: '/profile/org2',
          headers: { origin: 'https://evil.com' },
        });
        const result = await main(request, context);

        assert.strictEqual(result.status, 200);
      });
    });

    describe('Killswitch Enabled E2E', () => {
      const originalKillSwitch = SIDEKICK_CSRF_PROTECTION_CONFIG.enabled;

      before(() => {
        SIDEKICK_CSRF_PROTECTION_CONFIG.enabled = false;
      });

      after(() => {
        SIDEKICK_CSRF_PROTECTION_CONFIG.enabled = originalKillSwitch;
      });

      it('Should allow requests with killswitch enabled', async () => {
        const { request, context } = setupTest({
          suffix: '/profile',
          headers: { origin: 'https://www.example.com' },
        });
        const result = await main(request, context);

        assert.strictEqual(result.status, 200);
      });
    });
  });

  describe('Unit', () => {
    function setupTest({
      authInfo = AuthInfo.Default()
        .withProfile({
          email: 'bob@example.com',
        })
        .withPermissions(['code:read'])
        .withExtensionId('1234')
        .withAuthenticated(true),
      config = TEST_CONFIG,
      headers = {},
      method = 'GET',
      suffix = '/org/sites/site/status/',
    } = {}) {
      const context = createContext(suffix, {
        attributes: {
          authInfo,
          config,
        },
      });
      const info = createInfo(suffix, headers, method);

      return { context, info };
    }

    const originalKillSwitch = SIDEKICK_CSRF_PROTECTION_CONFIG.enabled;

    before(() => {
      SIDEKICK_CSRF_PROTECTION_CONFIG.enabled = true;
    });

    after(() => {
      SIDEKICK_CSRF_PROTECTION_CONFIG.enabled = originalKillSwitch;
    });

    describe('Authentication variations', () => {
      it('Missing auth info', async () => {
        const { context, info } = setupTest();
        delete context.attributes.authInfo;

        await sidekickCSRFProtection(context, info);
      });

      it('Authenticated, but not through the extension', async () => {
        const { context, info } = setupTest({
          authInfo: AuthInfo.Default()
            .withProfile({
              email: 'bob@example.com',
            })
            .withPermissions(['code:read'])
            .withAuthenticated(true),
        });

        await sidekickCSRFProtection(context, info);
      });
    });

    describe('Trusted origins for a site', () => {
      it('No origin in sec-fetch-mode: cors', async () => {
        // Exception for extension background workers
        const { context, info } = setupTest({
          headers: { 'sec-fetch-mode': 'cors' },
        });
        await sidekickCSRFProtection(context, info);
      });

      const origins = [
        'chrome-extension://1234',
        'https://main--site--org.aem.live',
        'https://dev--site--org.aem.page',
        'https://main--site--org.aem.reviews',
        'https://labs.aem.live',
        'https://tools.aem.live',
        'https://host.preview',
        'https://host.live',
        'https://host.prod',
        'http://localhost:3000',
        'https://dev--helix-labs-website--adobe.aem.page',
        'https://dev--helix-tools-website--adobe.aem.page',
        'https://sidekickextension.com',
        'https://my.extension.com',
        'https://somebranch--site--owner2.hlx.page',
        'https://somebranch--somesite--owner3.hlx.page',
        'https://drive.google.com',
        'https://docs.google.com',
      ];

      origins.forEach((origin) => {
        it(`${origin}`, async () => {
          const { context, info } = setupTest({
            headers: { origin },
          });
          await sidekickCSRFProtection(context, info);
        });
      });

      it('content source - da.live for da', async () => {
        const { context, info } = setupTest({
          config: {
            ...TEST_CONFIG,
            content: {
              source: {
                ...TEST_CONFIG.content.source,
                url: 'https://content.da.live',
                type: 'markup',
              },
            },
          },
          headers: { origin: 'https://da.live' },
        });

        await sidekickCSRFProtection(context, info);
      });
    });

    describe('Untrusted origins for a site', () => {
      it('No origin and with sec-fetch-mode: no-cors', async () => {
        const { context, info } = setupTest({
          headers: { 'sec-fetch-mode': 'cors' },
          method: 'POST',
        });
        await assert.rejects(
          sidekickCSRFProtection(context, info),
          AccessDeniedError,
        );
      });

      it('No origin and no sec-fetch-mode', async () => {
        const { context, info } = setupTest();
        await sidekickCSRFProtection(context, info);
      });

      const origins = [
        `https://${'a'.repeat(300)}.com`,
        'https://evil.com',
        'https://main--repo2--owner.aem.live',
        'https://main--repo--owner2.aem.live',
        'https://main--repo--owner.aem.live.org',
      ];

      origins.forEach((origin) => {
        it(`${origin}`, async () => {
          const { context, info } = setupTest({
            headers: { origin },
          });
          await assert.rejects(
            sidekickCSRFProtection(context, info),
            AccessDeniedError,
          );
        });
      });
    });

    describe('Trusted origins for a org', () => {
      const origins = [
        'chrome-extension://1234',
        'https://main--site1--org.aem.live',
        'https://dev--site2--org.aem.page',
        'https://labs.aem.live',
        'https://tools.aem.live',
        'http://localhost:3000',
        'https://dev--helix-tools-website--adobe.aem.page',
      ];

      origins.forEach((origin) => {
        it(`${origin}`, async () => {
          const { context, info } = setupTest({
            headers: { origin },
            suffix: '/org/config',
          });
          await sidekickCSRFProtection(context, info);
        });
      });
    });

    describe('Untrusted origins for a org', () => {
      it('No origin', async () => {
        const { context, info } = setupTest({
          headers: { 'sec-fetch-mode': 'no-cors' },
          suffix: '/org/config',
        });
        await assert.rejects(
          sidekickCSRFProtection(context, info),
          AccessDeniedError,
        );
      });

      const origins = [
        'https://evil.com',
        'https://main--site--org2.aem.live',
        'https://main--site--org.aem.live.org',
      ];

      origins.forEach((origin) => {
        it(`${origin}`, async () => {
          const { context, info } = setupTest({
            headers: { origin },
            suffix: '/org/config',
          });
          await assert.rejects(
            sidekickCSRFProtection(context, info),
            AccessDeniedError,
          );
        });
      });
    });

    describe('Trusted origins for top level (e.g. /profile)', () => {
      const origins = [
        'chrome-extension://1234',
        'https://labs.aem.live',
        'https://tools.aem.live',
        'http://localhost:3000',
        'https://dev--helix-tools-website--adobe.aem.page',
      ];

      origins.forEach((origin) => {
        it(`${origin}`, async () => {
          const { context, info } = setupTest({
            headers: { origin },
            suffix: '/profile',
          });
          await sidekickCSRFProtection(context, info);
        });
      });
    });

    describe('Untrusted origins top level', () => {
      it('No origin', async () => {
        const { context, info } = setupTest({
          headers: { 'sec-fetch-mode': 'no-cors' },
          suffix: '/profile',
        });
        await assert.rejects(
          sidekickCSRFProtection(context, info),
          AccessDeniedError,
        );
      });

      const origins = [
        'https://evil.com',
        'https://main--repo--owner.aem.live',
        'https://labs.aem.live.org',
        'https://main--helix-tools-website--adobe.aem.live.evil.com',
      ];

      origins.forEach((origin) => {
        it(`${origin}`, async () => {
          const { context, info } = setupTest({
            headers: { origin },
            suffix: '/profile',
          });
          await assert.rejects(
            sidekickCSRFProtection(context, info),
            AccessDeniedError,
          );
        });
      });
    });

    describe('Unexpected error', () => {
      it('Should not fail, just log', async () => {
        const originalIncludes = TRUSTED_ORIGINS.includes;
        try {
          TRUSTED_ORIGINS.includes = () => {
            throw new Error('Unexpected error');
          };

          const { context, info } = setupTest({
            headers: { origin: 'https://evil.com' },
            suffix: '/profile',
          });
          await sidekickCSRFProtection(context, info);
        } finally {
          TRUSTED_ORIGINS.includes = originalIncludes;
        }
      });
    });
  });
});
