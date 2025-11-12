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
import { parse } from 'cookie';
import {
  decodeJwt, exportJWK, generateKeyPair, SignJWT, UnsecuredJWT,
} from 'jose';
import { Request } from '@adobe/fetch';

import { sendAEMCLILoginInfoResponse } from '../../src/auth/responses.js';
import { IDPS } from '../../src/auth/support.js';
import { main } from '../../src/index.js';
import localJWKS from '../../src/idp-configs/jwks-json.js';
import idpFakeTestIDP from '../idp-configs/test-idp.js';
import { Nock, SITE_CONFIG } from '../utils.js';

const SITE_1D_CONFIG = {
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'onedrive',
      url: 'https://adobe.sharepoint.com/sites/Site/Shared%20Documents/site',
    },
  },
};

const SITE_1D_TENANT_CONFIG = {
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'onedrive',
      url: 'https://adobe.sharepoint.com/sites/Site/Shared%20Documents/site',
      tenantId: 'tenantid-override',
    },
  },
};

const SITE_MUP_CONFIG = {
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'markup',
      url: 'https://autho-p123-e123.adobeaemcloud.com/bin/franklin.delivery/owner/repo/ref',
      suffix: '.html',
    },
  },
};

const SITE_DA_CONFIG = {
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'onedrive',
      url: 'https://adobe.sharepoint.com/sites/Site/Shared%20Documents/site',
    },
    overlay: {
      type: 'markup',
      url: 'https://content.da.live/owner/repo',
    },
  },
};

function extractMessage(html) {
  return html.match(/"1234", ({.*?})/)[1];
}

function extractTokenFromMessageHTML(html) {
  return html.match(/"authToken":"([^"]+)"/)[1];
}

describe('Login Handler Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(suffix = '/', { authInfo, query, env } = {}) {
    const qs = new URLSearchParams(query);
    const request = new Request(`https://api.aem.live${suffix}?${qs}`);
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo,
      },
      env: {
        HLX_ADMIN_APP_GOOGLE_CLIENT_ID: 'google-client-id',
        HLX_ADMIN_APP_GOOGLE_CLIENT_SECRET: 'google-client-secret',
        HLX_ADMIN_APP_AZURE_CLIENT_ID: 'azure-client-id',
        HLX_ADMIN_APP_AZURE_CLIENT_SECRET: 'azure-client-secret',
        HLX_ADMIN_APP_IMS_CLIENT_ID: 'ims-client-id',
        HLX_ADMIN_APP_IMS_CLIENT_SECRET: 'ims-client-secret',
        HLX_ADMIN_APP_IMS_STG_CLIENT_ID: 'ims-stage-client-id',
        HLX_ADMIN_APP_IMS_STG_CLIENT_SECRET: 'ims-stage-client-secret',
        ...env,
      },
    };
    return { request, context };
  }

  describe('login and logout', () => {
    it('/login: renders default login links', async () => {
      const { request, context } = setupTest('/login');
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(await result.json(), {
        links: {
          login_adobe: 'https://api.aem.live/auth/adobe',
          'login_adobe-stage': 'https://api.aem.live/auth/adobe-stg',
          'login_adobe-stage_sa': 'https://api.aem.live/auth/adobe-stg?selectAccount=true',
          login_adobe_sa: 'https://api.aem.live/auth/adobe?selectAccount=true',
          login_google: 'https://api.aem.live/auth/google',
          login_google_sa: 'https://api.aem.live/auth/google?selectAccount=true',
          login_microsoft: 'https://api.aem.live/auth/microsoft',
          login_microsoft_sa: 'https://api.aem.live/auth/microsoft?selectAccount=true',
          login_test: 'https://api.aem.live/auth/test',
          login_test_sa: 'https://api.aem.live/auth/test?selectAccount=true',
        },
      });
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/login: renders logout link for profile', async () => {
      const { request, context } = setupTest('/login', {
        authInfo: {
          profile: {
            email: 'bob@example.com',
          },
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(await result.json(), {
        links: {
          logout: 'https://api.aem.live/logout',
        },
      });
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/login: redirects to login link with expired auth info', async () => {
      const { request, context } = setupTest('/login', {
        authInfo: {
          expired: true,
          loginHint: 'bob@example.com',
          profile: {
            email: 'bob@example.com',
          },
          idp: idpFakeTestIDP,
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');

      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.ok(sp.state);
      delete sp.nonce;
      delete sp.state;
      assert.deepStrictEqual(sp, {
        client_id: 'dummy-clientid',
        login_hint: 'bob@example.com',
        prompt: 'none',
        redirect_uri: 'https://api.aem.live/auth/test/ack',
        response_type: 'code',
        scope: 'openid profile email',
      });
      loc.search = '';
      assert.strictEqual(loc.href, 'https://accounts.example.com/o/oauth2/v2/auth');
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      });
    });

    it('/login: sends 404 for missing config', async () => {
      nock.siteConfig().reply(404);

      const { request, context } = setupTest('/login', {
        query: {
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 404);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'project not found: org/site',
        vary: 'Accept-Encoding',
      });
    });

    it('/login: redirects to google login for google project', async () => {
      nock.siteConfig(SITE_CONFIG);

      const { request, context } = setupTest('/login', {
        query: {
          loginRedirect: 'https://www.aem.live',
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');

      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.ok(sp.state);
      delete sp.nonce;
      assert.deepStrictEqual(decodeJwt(sp.state), {
        org: 'org',
        site: 'site',
        prompt: 'none',
      });
      assert.deepStrictEqual(sp, {
        client_id: 'google-client-id',
        prompt: 'none',
        redirect_uri: 'https://api.aem.live/auth/google/ack',
        response_type: 'code',
        scope: 'openid profile email',
        state: 'eyJhbGciOiJub25lIn0.eyJwcm9tcHQiOiJub25lIiwib3JnIjoib3JnIiwic2l0ZSI6InNpdGUifQ.',
      });
      loc.search = '';
      assert.strictEqual(loc.href, 'https://accounts.google.com/o/oauth2/v2/auth');
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      });
    });

    it('/login: redirects to microsoft login for sharepoint project', async () => {
      nock.siteConfig(SITE_1D_CONFIG);
      nock.onedrive(SITE_1D_CONFIG.content).resolveTenant();

      const { request, context } = setupTest('/login', {
        query: {
          selectAccount: 'true',
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');

      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.deepStrictEqual(decodeJwt(sp.state), {
        org: 'org',
        site: 'site',
        prompt: 'select_account',
        tenantId: 'fa7b1b5a-7b34-4387-94ae-d2c178decee1',
      });
      delete sp.nonce;
      assert.deepStrictEqual(sp, {
        client_id: 'azure-client-id',
        prompt: 'select_account',
        redirect_uri: 'https://api.aem.live/auth/microsoft/ack',
        response_type: 'code',
        scope: 'openid profile email',
        state: 'eyJhbGciOiJub25lIn0.eyJwcm9tcHQiOiJzZWxlY3RfYWNjb3VudCIsIm9yZyI6Im9yZyIsInNpdGUiOiJzaXRlIiwidGVuYW50SWQiOiJmYTdiMWI1YS03YjM0LTQzODctOTRhZS1kMmMxNzhkZWNlZTEifQ.',
      });
      loc.search = '';
      assert.strictEqual(loc.href, 'https://login.microsoftonline.com/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/authorize');
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      });
    });

    it('/login: redirects to microsoft login for sharepoint project (provided tenant id)', async () => {
      nock.siteConfig(SITE_1D_CONFIG);

      const { request, context } = setupTest('/login', {
        query: {
          selectAccount: 'true',
          tenantId: 'common',
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');

      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.deepStrictEqual(decodeJwt(sp.state), {
        org: 'org',
        site: 'site',
        prompt: 'select_account',
        tenantId: 'common',
      });
      delete sp.nonce;
      assert.deepStrictEqual(sp, {
        client_id: 'azure-client-id',
        prompt: 'select_account',
        redirect_uri: 'https://api.aem.live/auth/microsoft/ack',
        response_type: 'code',
        scope: 'openid profile email',
        state: 'eyJhbGciOiJub25lIn0.eyJwcm9tcHQiOiJzZWxlY3RfYWNjb3VudCIsIm9yZyI6Im9yZyIsInNpdGUiOiJzaXRlIiwidGVuYW50SWQiOiJjb21tb24ifQ.',
      });
      loc.search = '';
      assert.strictEqual(loc.href, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      });
    });

    it('/login: redirects to microsoft login for sharepoint project (custom tenant id)', async () => {
      nock.siteConfig(SITE_1D_TENANT_CONFIG);

      const { request, context } = setupTest('/login', {
        query: {
          selectAccount: 'true',
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');

      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.deepStrictEqual(decodeJwt(sp.state), {
        org: 'org',
        site: 'site',
        prompt: 'select_account',
        tenantId: 'tenantid-override',
      });
      delete sp.nonce;
      assert.deepStrictEqual(sp, {
        client_id: 'azure-client-id',
        prompt: 'select_account',
        redirect_uri: 'https://api.aem.live/auth/microsoft/ack',
        response_type: 'code',
        scope: 'openid profile email',
        state: 'eyJhbGciOiJub25lIn0.eyJwcm9tcHQiOiJzZWxlY3RfYWNjb3VudCIsIm9yZyI6Im9yZyIsInNpdGUiOiJzaXRlIiwidGVuYW50SWQiOiJ0ZW5hbnRpZC1vdmVycmlkZSJ9.',
      });
      loc.search = '';
      assert.strictEqual(loc.href, 'https://login.microsoftonline.com/tenantid-override/oauth2/v2.0/authorize');
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      });
    });

    it('/login: redirects to adobe login for markup project', async () => {
      nock.siteConfig(SITE_MUP_CONFIG);

      const { request, context } = setupTest('/login', {
        query: {
          selectAccount: 'true',
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');

      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.deepStrictEqual(decodeJwt(sp.state), {
        org: 'org',
        site: 'site',
        prompt: 'login',
      });
      delete sp.nonce;
      assert.deepStrictEqual(sp, {
        client_id: 'ims-client-id',
        prompt: 'login',
        redirect_uri: 'https://api.aem.live/auth/adobe/ack',
        response_type: 'code',
        scope: 'AdobeID openid profile email ab.manage gnav org.read read_organizations session additional_info.ownerOrg additional_info.projectedProductContext aem.frontend.all',
        state: 'eyJhbGciOiJub25lIn0.eyJwcm9tcHQiOiJsb2dpbiIsIm9yZyI6Im9yZyIsInNpdGUiOiJzaXRlIn0.',
      });
      loc.search = '';
      assert.strictEqual(loc.href, 'https://ims-na1.adobelogin.com/ims/authorize/v2');
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      });
    });

    it('/login: redirects to adobe login for DA overlay', async () => {
      nock.siteConfig(SITE_DA_CONFIG);

      const { request, context } = setupTest('/login', {
        query: {
          selectAccount: 'true',
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');

      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.deepStrictEqual(decodeJwt(sp.state), {
        org: 'org',
        site: 'site',
        prompt: 'login',
      });
      delete sp.nonce;
      assert.deepStrictEqual(sp, {
        client_id: 'ims-client-id',
        prompt: 'login',
        redirect_uri: 'https://api.aem.live/auth/adobe/ack',
        response_type: 'code',
        scope: 'AdobeID openid profile email ab.manage gnav org.read read_organizations session additional_info.ownerOrg additional_info.projectedProductContext aem.frontend.all',
        state: 'eyJhbGciOiJub25lIn0.eyJwcm9tcHQiOiJsb2dpbiIsIm9yZyI6Im9yZyIsInNpdGUiOiJzaXRlIn0.',
      });
      loc.search = '';
      assert.strictEqual(loc.href, 'https://ims-na1.adobelogin.com/ims/authorize/v2');
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      });
    });

    it('/login: idp parameter overrides project default', async () => {
      nock.siteConfig(SITE_CONFIG);

      const { request, context } = setupTest('/login', {
        query: {
          idp: 'microsoft',
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');

      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.deepStrictEqual(decodeJwt(sp.state), {
        org: 'org',
        site: 'site',
        prompt: 'none',
      });
      delete sp.nonce;
      assert.deepStrictEqual(sp, {
        client_id: 'azure-client-id',
        prompt: 'none',
        redirect_uri: 'https://api.aem.live/auth/microsoft/ack',
        response_type: 'code',
        scope: 'openid profile email',
        state: 'eyJhbGciOiJub25lIn0.eyJwcm9tcHQiOiJub25lIiwib3JnIjoib3JnIiwic2l0ZSI6InNpdGUifQ.',
      });
      loc.search = '';
      assert.strictEqual(loc.href, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      });
    });

    it('/login: aem-cli redirects with downstream client info in state', async () => {
      nock.siteConfig(SITE_1D_CONFIG);
      nock.onedrive(SITE_1D_CONFIG.content).resolveTenant();

      const { request, context } = setupTest('/login', {
        query: {
          client_id: 'aem-cli',
          redirect_uri: 'http://localhost:3000/.aem/cli/login/ack',
          state: 'r4nd0m',
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');

      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.deepStrictEqual(decodeJwt(sp.state), {
        org: 'org',
        site: 'site',
        prompt: 'none',
        tenantId: 'fa7b1b5a-7b34-4387-94ae-d2c178decee1',
        forwardedInfo: {
          clientId: 'aem-cli',
          redirectUri: 'http://localhost:3000/.aem/cli/login/ack',
          state: 'r4nd0m',
        },
      });
    });

    it('/login: aem-cli fails with invalid redirect uri', async () => {
      nock.siteConfig(SITE_1D_CONFIG);
      nock.onedrive(SITE_1D_CONFIG.content).resolveTenant();

      const { request, context } = setupTest('/login', {
        query: {
          client_id: 'aem-cli',
          redirect_uri: 'https://example.com',
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 401);
    });

    it('/login: fails with invalid client id', async () => {
      nock.siteConfig(SITE_1D_CONFIG);
      nock.onedrive(SITE_1D_CONFIG.content).resolveTenant();

      const { request, context } = setupTest('/login', {
        query: {
          client_id: 'invalid',
          redirect_uri: 'http://localhost:3000/.aem/cli/login/ack',
          state: 'r4nd0m',
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 401);
    });

    it('microsoft idp has custom issuer validator', async () => {
      const idp = IDPS.find((i) => i.name === 'microsoft');
      assert.strictEqual(idp.validateIssuer('https://login.microsoftonline.com/common'), true);
      assert.strictEqual(idp.validateIssuer('https://www.example/com/common'), false);
    });

    it('/logout: redirects to login', async () => {
      const { request, context } = setupTest('/logout');
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        location: 'https://api.aem.live/profile',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      });
    });

    it('/logout: with extension sends message to sidekick', async () => {
      const { request, context } = setupTest('/logout', {
        query: {
          extensionId: '1234',
        },
      });
      const result = await main(request, context);

      assert.match(await result.text(), /chrome.runtime.sendMessage\("1234"/);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/logout: with cookie extension sends message to sidekick', async () => {
      const { request, context } = setupTest('/logout', {
        query: {
          extensionId: 'cookie',
        },
      });
      const result = await main(request, context);

      assert.match(await result.text(), /window\.close/);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
        vary: 'Accept-Encoding',
      });
    });

    it('/logout/owner/repo: redirects to default profile', async () => {
      const { request, context } = setupTest('/logout', {
        query: {
          org: 'org',
          site: 'site',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      assert.deepStrictEqual(await result.text(), '');
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        location: 'https://api.aem.live/profile',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
      });
    });
  });

  describe('IDP login redirects', () => {
    for (const idp of IDPS) {
      const path = idp.routes.login;
      it(`${path}: redirects to the ${idp.name} login page`, async () => {
        const { request, context } = setupTest(path);
        const result = await main(request, context);

        assert.strictEqual(result.status, 302);
        assert.deepStrictEqual(await result.text(), '');

        const headers = result.headers.plain();
        const loc = new URL(headers.location);
        delete headers.location;
        const sp = Object.fromEntries(loc.searchParams.entries());
        assert.ok(sp.nonce);
        assert.ok(sp.state);
        delete sp.nonce;
        delete sp.state;
        assert.deepStrictEqual(sp, {
          client_id: idp.client(context).clientId,
          prompt: 'none',
          redirect_uri: `https://api.aem.live${idp.routes.loginRedirect}`,
          response_type: 'code',
          scope: idp.scope,
        });
        loc.search = '';
        assert.strictEqual(loc.href, idp.discovery.authorization_endpoint.replace('{tenantid}', 'common'));
        assert.deepStrictEqual(headers, {
          'cache-control': 'no-store, private, must-revalidate',
          'content-type': 'text/plain; charset=utf-8',
          'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
        });
      });
    }
  });

  describe('Auth tests', () => {
    let privateKey;
    let privateJwk;

    before(async () => {
      const keyPair = await generateKeyPair('RS256', { extractable: true });
      privateKey = keyPair.privateKey;
      privateJwk = await exportJWK(privateKey);
      const publicJwk = await exportJWK(keyPair.publicKey);
      idpFakeTestIDP.discovery.jwks = {
        keys: [
          publicJwk,
        ],
      };
    });

    it('/auth returns 404 if no idp handles the auth route', async () => {
      const { request, context } = setupTest('/auth/foobar');
      const result = await main(request, context);

      assert.strictEqual(result.status, 404);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/auth/discovery/keys returns JWKS', async () => {
      const { request, context } = setupTest('/auth/discovery/keys');
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(await result.json(), localJWKS);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it.skip('/auth/test?selectAccount sends redirect to prompt login', async () => {
      const { request, context } = setupTest('/auth/test', {
        query: {
          selectAccount: 'true',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.deepStrictEqual(decodeJwt(sp.state), {
        org: 'test', // TODO: this won't be there
        prompt: 'select_account',
      });
      delete sp.nonce;
      assert.deepStrictEqual(sp, {
        client_id: 'dummy-clientid',
        redirect_uri: 'https://api.aem.live/auth/test/ack',
        response_type: 'code',
        scope: 'openid profile email',
        prompt: 'select_account',
        state: 'eyJhbGciOiJub25lIn0.eyJwcm9tcHQiOiJzZWxlY3RfYWNjb3VudCIsIm9yZyI6InRlc3QifQ.',
      });
      loc.search = '';
      assert.strictEqual(loc.href, 'https://accounts.example.com/o/oauth2/v2/auth');
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
        'content-type': 'text/plain; charset=utf-8',
      });
    });

    it('/auth/test/ack fails with 401 if no code and no state', async () => {
      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          error: 'consent_required',
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 401);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
      });
    });

    it('/auth/test/ack fails with 401 if no code and prompt state', async () => {
      const state = new UnsecuredJWT({
        prompt: 'select_account',
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          error: 'wrong-login',
          state,
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 401);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
      });
    });

    it('/auth/test/ack sends redirect to prompt login for non-prompt state', async () => {
      const state = new UnsecuredJWT({
        prompt: 'none',
        loginRedirect: 'https://www.hlx.live/',
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          error: 'consent_required',
          state,
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 302);
      const headers = result.headers.plain();
      const loc = new URL(headers.location);
      delete headers.location;
      const sp = Object.fromEntries(loc.searchParams.entries());
      assert.ok(sp.nonce);
      assert.deepStrictEqual(decodeJwt(sp.state), {
        prompt: '',
      });
      delete sp.nonce;
      assert.deepStrictEqual(sp, {
        client_id: 'dummy-clientid',
        redirect_uri: 'https://api.aem.live/auth/test/ack',
        response_type: 'code',
        scope: 'openid profile email',
        state: 'eyJhbGciOiJub25lIn0.eyJwcm9tcHQiOiIifQ.',
      });
      loc.search = '';
      assert.strictEqual(loc.href, 'https://accounts.example.com/o/oauth2/v2/auth');
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'set-cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
        'content-type': 'text/plain; charset=utf-8',
      });
    });

    it('/auth/test/ack exchanges the token', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        oid: '1234',
        preferred_username: 'to123@acme.com',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
            access_token: 'dummy-access-token',
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        org: 'owner',
        site: 'repo',
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const headers = result.headers.plain();
      const cookie = parse(headers['set-cookie']);
      delete headers['set-cookie'];
      assert.deepStrictEqual(headers, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, private, must-revalidate',
        vary: 'Accept-Encoding',
      });
      const decoded = decodeJwt(cookie.auth_token);
      assert.deepStrictEqual(decoded, {
        email: 'test@example.com',
        exp: decoded.exp,
        iat: decoded.iat,
        iss: 'https://admin.hlx.page/',
        name: 'Test User',
        oid: '1234',
        sub: '*/*',
        preferred_username: 'to123@acme.com',
      });

      assert.ok((await result.text()).includes('https://api.aem.live/profile'));
    });

    it('/auth/test/ack exchanges the token for DA', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        given_name: 'Test',
        family_name: 'User',
        sub: '112233@adobe',
        oid: '1234',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      const createdAt = Date.now() - 1000;
      const expiresIn = 86400000;

      const accessToken = await new SignJWT({
        type: 'access_token',
        expires_in: `${expiresIn}`,
        created_at: `${createdAt}`,
        scope: 'AdobeID,openid,profile,email,ab.manage,gnav,org.read,read_organizations,session,additional_info.ownerOrg,additional_info.projectedProductContext,aem.frontend.all',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .sign(privateKey);

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
            access_token: accessToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        org: 'owner',
        site: 'repo',
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const headers = result.headers.plain();
      const cookie = parse(headers['set-cookie']);
      delete headers['set-cookie'];
      assert.deepStrictEqual(headers, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, private, must-revalidate',
        vary: 'Accept-Encoding',
      });
      const decoded = decodeJwt(cookie.auth_token);
      assert.deepStrictEqual(decoded, {
        email: 'test@example.com',
        exp: Math.floor((createdAt + expiresIn) / 1000),
        iat: Math.floor(createdAt / 1000),
        imsToken: accessToken,
        iss: 'https://admin.hlx.page/',
        name: 'Test User',
        user_id: '112233@adobe',
        oid: '1234',
        sub: '*/*',
      });

      assert.ok((await result.text()).includes('https://api.aem.live/profile'));
    });

    it('/auth/test/ack exchanges the token on a non project login', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const headers = result.headers.plain();
      assert.ok(headers['set-cookie']);
      delete headers['set-cookie'];
      assert.deepStrictEqual(headers, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, private, must-revalidate',
        vary: 'Accept-Encoding',
      });
      assert.ok((await result.text()).includes('https://api.aem.live/profile'));
    });

    it('/auth/test/ack exchanges the token and sends message to sidekick with picture', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('https://login.microsoftonline.com/{tenantid}/v2.0')
        .setAudience('azure-client-id')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock.siteConfig(SITE_1D_CONFIG);

      nock('https://login.microsoftonline.com')
        .post('/common/oauth2/v2.0/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'azure-client-id',
            client_secret: 'azure-client-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/microsoft/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        })
        .get('/common/discovery/v2.0/keys')
        .reply(200, idpFakeTestIDP.discovery.jwks);
      nock('https://graph.microsoft.com')
        .get('/v1.0/me/photos/48x48/$value')
        .reply(200, ':-)', {
          'cache-control': 'no-cache',
          'content-type': 'image/jpeg',
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        loginRedirect: 'https://www.aem.live/',
        extensionId: '1234',
        org: 'org',
        site: 'site',
      }).encode();

      const { request, context } = setupTest('/auth/microsoft/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const html = await result.text();
      assert.match(html, /chrome.runtime.sendMessage\("1234"/);
      assert.ok(html.includes('"authToken":'));
      assert.ok(html.includes('"picture":"data:image/jpeg;base64,Oi0p"'));
      const message = JSON.parse(extractMessage(html));
      const decoded = decodeJwt(message.authToken);
      assert.deepStrictEqual(decoded, {
        email: 'test@example.com',
        exp: decoded.exp,
        iat: decoded.iat,
        iss: 'https://admin.hlx.page/',
        name: 'Test User',
        extensionId: '1234',
        sub: '*/*',
      });
      assert.strictEqual(decoded.exp * 1000, message.exp);

      assert.ok(!html.includes('"siteToken"'));
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/auth/test/ack exchanges the token and sends message to sidekick with a too large picture', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('https://login.microsoftonline.com/{tenantid}/v2.0')
        .setAudience('azure-client-id')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock.siteConfig(SITE_1D_CONFIG);

      nock('https://login.microsoftonline.com')
        .post('/common/oauth2/v2.0/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'azure-client-id',
            client_secret: 'azure-client-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/microsoft/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        })
        .get('/common/discovery/v2.0/keys')
        .reply(200, idpFakeTestIDP.discovery.jwks);
      nock('https://graph.microsoft.com')
        .get('/v1.0/me/photos/48x48/$value')
        .reply(200, Buffer.alloc(8192), {
          'cache-control': 'no-cache',
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        loginRedirect: 'https://www.aem.live/',
        extensionId: '1234',
        org: 'org',
        site: 'site',
      }).encode();

      const { request, context } = setupTest('/auth/microsoft/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const html = await result.text();
      assert.match(html, /chrome.runtime.sendMessage\("1234"/);
      assert.ok(html.includes('"authToken":'));
      assert.ok(html.includes('"picture":""'));
      const decoded = decodeJwt(extractTokenFromMessageHTML(html));
      assert.deepStrictEqual(decoded, {
        email: 'test@example.com',
        exp: decoded.exp,
        iat: decoded.iat,
        iss: 'https://admin.hlx.page/',
        name: 'Test User',
        extensionId: '1234',
        sub: '*/*',
      });

      assert.ok(!html.includes('"siteToken"'));
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/auth/test/ack exchanges the token and sends message to sidekick even if picture fails', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('https://login.microsoftonline.com/{tenantid}/v2.0')
        .setAudience('azure-client-id')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock.siteConfig(SITE_1D_CONFIG);

      nock('https://login.microsoftonline.com')
        .post('/common/oauth2/v2.0/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'azure-client-id',
            client_secret: 'azure-client-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/microsoft/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        })
        .get('/common/discovery/v2.0/keys')
        .reply(200, idpFakeTestIDP.discovery.jwks);
      nock('https://graph.microsoft.com')
        .get('/v1.0/me/photos/48x48/$value')
        .reply(404);

      const state = new UnsecuredJWT({
        prompt: 'none',
        loginRedirect: 'https://www.hlx.live/',
        extensionId: '1234',
        org: 'org',
        site: 'site',
      }).encode();

      const { request, context } = setupTest('/auth/microsoft/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const html = await result.text();
      assert.match(html, /chrome.runtime.sendMessage\("1234"/);
      assert.ok(html.includes('"authToken":'));
      assert.ok(html.includes('"picture":""'));
      const decoded = decodeJwt(extractTokenFromMessageHTML(html));
      assert.deepStrictEqual(decoded, {
        email: 'test@example.com',
        exp: decoded.exp,
        iat: decoded.iat,
        iss: 'https://admin.hlx.page/',
        name: 'Test User',
        extensionId: '1234',
        sub: '*/*',
      });

      assert.ok(!html.includes('"siteToken"'));
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/auth/test/ack exchanges the token and sends message to sidekick with helix5 site auth', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock.siteConfig(JSON.stringify({
        ...SITE_CONFIG,
        access: {
          preview: {
            apiKeyId: ['dummy'],
          },
          admin: {
            role: {
              author: ['*@example.com'],
            },
          },
        },
      }));

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        loginRedirect: 'https://www.aem.live/',
        extensionId: '1234',
        org: 'org',
        site: 'site',
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const html = await result.text();
      assert.match(html, /chrome.runtime.sendMessage\("1234"/);
      assert.ok(html.includes('"exp":'));
      assert.ok(html.includes('"siteToken":"hlxtst_'));
      assert.ok(html.includes('"siteTokenExpiry":'));
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/auth/test/ack aem-cli: exchanges the token and sends site token', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock.siteConfig(JSON.stringify({
        ...SITE_CONFIG,
        access: {
          preview: {
            apiKeyId: ['dummy'],
          },
          admin: {
            role: {
              author: ['*@example.com'],
            },
          },
        },
      }));

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        org: 'org',
        site: 'site',
        forwardedInfo: {
          clientId: 'aem-cli',
          state: 'r4nd0m',
          redirectUri: 'http://localhost:3000/.aem/cli/login/ack',
        },
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const html = await result.text();

      assert.ok(html.includes('sendPost("http://localhost:3000/.aem/cli/login/ack", '));
      assert.ok(html.includes('"state":"r4nd0m"'));
      assert.ok(html.includes('"siteToken":"hlxtst_ey'));
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/auth/test/ack exchanges the token and does not send it because of invalid client', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        org: 'org',
        site: 'site',
        forwardedInfo: {
          clientId: 'invalid',
          state: 'r4nd0m',
          redirectUri: 'http://localhost:3000/.aem/cli/login/ack',
        },
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      /*
      currently all requests from any other client than aem-cli is ignored
      and the login proceeds like a login to helix admin itself
      */
      assert.strictEqual(result.status, 200);
      const html = await result.text();
      assert.ok(!html.includes('sendPost("http://localhost:3000/.aem/cli/login/ack", '));
      assert.ok(!html.includes('"state":"r4nd0m"'));
      assert.ok(!html.includes('"siteToken":"hlxtst_ey'));
    });

    it('/auth/test/ack aem-cli: exchanges the token and does not send it because of invalid redirect uri', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        org: 'org',
        site: 'site',
        forwardedInfo: {
          clientId: 'aem-cli',
          state: 'r4nd0m',
          redirectUri: 'https://example.com',
        },
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);
      assert.strictEqual(result.status, 401);
    });

    it('/auth/test/ack aem-cli: exchanges the token and does not send it because of invalid redirect uri', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        org: 'org',
        site: 'site',
        forwardedInfo: {
          clientId: 'aem-cli',
          state: 'r4nd0m',
          redirectUri: 'https://example.com',
        },
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);
      assert.strictEqual(result.status, 401);
    });

    it('/auth/test/ack aem-cli: exchanges the token and does not send it because of invalid redirect uri', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        org: 'org',
        site: 'site',
        forwardedInfo: {
          clientId: 'aem-cli',
          state: 'r4nd0m',
          redirectUri: 'https://example.com',
        },
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);
      assert.strictEqual(result.status, 401);
    });

    it('/auth/test/ack aem-cli: exchanges the token and does not send the site token because of missing email in id_token', async () => {
      const idToken = await new SignJWT({
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        org: 'org',
        site: 'site',
        forwardedInfo: {
          clientId: 'aem-cli',
          state: 'r4nd0m',
          redirectUri: 'http://localhost:3000/.aem/cli/login/ack',
        },
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);
      assert.strictEqual(result.status, 401);
    });

    it('/auth/test/ack aem-cli: exchanges the token and sends site token', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock.siteConfig(JSON.stringify({
        ...SITE_CONFIG,
        access: {
          preview: {
            apiKeyId: ['dummy'],
          },
          admin: {
            role: {
              author: ['*@example.com'],
            },
          },
        },
      }));

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        org: 'org',
        site: 'site',
        forwardedInfo: {
          clientId: 'aem-cli',
          state: 'r4nd0m',
        },
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const html = await result.text();

      assert.ok(html.includes('sendPost("http://localhost:3000/.aem/cli/login/ack", '));
      assert.ok(html.includes('"state":"r4nd0m"'));
      assert.ok(html.includes('"siteToken":"hlxtst_ey'));
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/auth/test/ack exchanges the token without site token if email is missing', async () => {
      const idToken = await new SignJWT({
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        loginRedirect: 'https://www.hlx.live/',
        extensionId: '1234',
        org: 'org',
        site: 'site',
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_TST_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const html = await result.text();
      assert.match(html, /chrome.runtime.sendMessage\("1234"/);
      assert.ok(html.includes('"exp":'));
      assert.ok(!html.includes('"siteToken":"hlxtst_'));
      assert.ok(!html.includes('"siteTokenExpiry":'));
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/auth/test/ack exchanges the token and closes window for cookie', async () => {
      const idToken = await new SignJWT({
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setIssuer('urn:example:issuer')
        .setAudience('dummy-clientid')
        .setExpirationTime('2h')
        .sign(privateKey);

      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: idToken,
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        loginRedirect: 'https://www.hlx.live/',
        extensionId: 'cookie',
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
        env: {
          HLX_ADMIN_IDP_PRIVATE_KEY: JSON.stringify(privateJwk),
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 200);
      const headers = result.headers.plain();
      assert.ok(headers['set-cookie']);
      delete headers['set-cookie'];
      const html = await result.text();
      assert.match(html, /window\.close/);
      assert.deepStrictEqual(headers, {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/html; charset=utf-8',
        vary: 'Accept-Encoding',
      });
    });

    it('/auth/test/ack handles error from exchange token call', async () => {
      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [400, {
            error: 'code expired',
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 401);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
      });
    });

    it('/auth/test/ack handles error from exchange from microsoft', async () => {
      nock('https://login.microsoftonline.com')
        .post('/my-tenant-id/oauth2/v2.0/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'azure-client-id',
            client_secret: 'azure-client-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/microsoft/ack',
          });
          return [400, {
            error: 'invalid_grant',
            error_codes: [500202],
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
        tenantId: 'my-tenant-id',
      }).encode();

      const { request, context } = setupTest('/auth/microsoft/ack', {
        query: {
          code: '1234',
          state,
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 401);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
      });
    });

    it('/auth/test/ack handles invalid id_tokens', async () => {
      nock('https://www.example.com')
        .post('/token')
        .reply((_, body) => {
          assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(body).entries()), {
            client_id: 'dummy-clientid',
            client_secret: 'dummy-secret',
            code: '1234',
            grant_type: 'authorization_code',
            redirect_uri: 'https://api.aem.live/auth/test/ack',
          });
          return [200, {
            id_token: 'this is not token!',
          }, {
            'content-type': 'application/json',
          }];
        });

      const state = new UnsecuredJWT({
        prompt: 'none',
      }).encode();

      const { request, context } = setupTest('/auth/test/ack', {
        query: {
          code: '1234',
          state,
        },
      });
      const result = await main(request, context);

      assert.strictEqual(result.status, 401);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
      });
    });

    it('no javascript protocol not supported in the redirect uri', async () => {
      // eslint-disable-next-line no-script-url
      const result = sendAEMCLILoginInfoResponse('javascript:alert("xss")', {});
      assert.strictEqual(result.status, 401);
    });
  });
});
