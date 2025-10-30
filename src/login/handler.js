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
import { Response } from '@adobe/fetch';
import { OneDriveAuth } from '@adobe/helix-onedrive-support';
import { decodeJwt } from 'jose';

import { clearAuthCookie } from '../auth/cookie.js';
import { exchangeToken } from '../auth/exchange-token.js';
import { redirectToLogin } from '../auth/redirect-login.js';
import { createCloseHtml, createSendMessageHtml } from '../auth/responses.js';
import { IDPS, LOGOUT_PATH, PROFILE_PATH } from '../auth/support.js';
import { createErrorResponse } from '../contentbus/utils.js';
import { isDAMountpoint } from '../support/adobe-source.js';
import idpAdobe from '../idp-configs/adobe.js';
import localJWKS from '../idp-configs/jwks-json.js';
import { loadSiteConfig } from '../config/utils.js';

/**
 * Clears the authentication cookie.
 *
 * @param {AdminContext} ctx the context of the universal serverless function
 * @param {PathInfo} info path info
 * @returns {Promise<Response>}
 */
export async function logout(ctx, info) {
  const extensionId = ctx.data?.extensionId;
  const { log } = ctx;
  const { org, site } = info;
  if (extensionId === 'cookie') {
    log.debug('logout: creating html for cookie logout');
    return new Response(createCloseHtml('Logout successful'), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, private, must-revalidate',
        'set-cookie': clearAuthCookie(),
      },
    });
  }

  if (extensionId) {
    log.debug(`logout: creating extension html for ${extensionId}`);
    // deliver extension html
    const msg = {
      action: 'updateAuthToken',
      authToken: '',
      owner: org,
      repo: site,
      org,
      site,
    };
    const html = createSendMessageHtml(extensionId, msg);
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, private, must-revalidate',
      },
    });
  }

  const location = info.getLinkUrl(PROFILE_PATH);
  log.debug('logout: redirecting to profile page with id_token cookie', location);
  return new Response('', {
    status: 302,
    headers: {
      'cache-control': 'no-store, private, must-revalidate',
      'set-cookie': clearAuthCookie(),
      location,
    },
  });
}

/**
 * Handles the login route
 * @param {AdminContext} ctx the universal context
 * @param {PathInfo} info path info
 * @returns {Promise<Response>} response
 */
export async function login(ctx, info) {
  const { log, attributes: { authInfo }, data } = ctx;

  // for login requests with repo coordinates, perform mountpoint specific login
  if (data.org && data.site) {
    const opts = {
      noPrompt: true,
      loginHint: authInfo.loginHint,
      tenantId: data.tenantId,
    };

    const config = await loadSiteConfig(ctx, data.org, data.site);
    if (!config) {
      return createErrorResponse({
        log,
        status: 404,
        msg: `project not found: ${data.org}/${data.site}`,
      });
    }

    if (isDAMountpoint(config.content?.overlay)) {
      return redirectToLogin(ctx, info, idpAdobe, opts);
    }

    // for sharepoint sources, try to detect the tenant
    const { content: { source } } = config;
    if (source.type === 'onedrive' && !opts.tenantId) {
      if (source.tenantId) {
        opts.tenantId = source.tenantId;
      } else {
        const oneAuth = new OneDriveAuth({
          log,
          clientId: 'dummy',
          clientSecret: 'dummy',
        });
        opts.tenantId = await oneAuth.initTenantFromUrl(source.url);
      }
    }

    if (data?.idp) {
      const idp = IDPS.find(({ name }) => name === data.idp);
      if (idp) {
        return redirectToLogin(ctx, info, idp, opts);
      }
    }
    for (const idp of IDPS) {
      if (idp.mountType === source.type) {
        return redirectToLogin(ctx, info, idp, opts);
      }
    }
    return createErrorResponse({
      log,
      status: 401,
      msg: 'no IDP claims mountpoint.',
    });
  }

  if (authInfo.expired && authInfo.idp) {
    return redirectToLogin(ctx, info, authInfo.idp, {
      noPrompt: true,
      loginHint: authInfo.loginHint,
    });
  }

  const body = {
    links: {},
  };
  if (authInfo.profile) {
    body.links.logout = info.getLinkUrl(LOGOUT_PATH);
  } else {
    for (const idp of IDPS) {
      body.links[`login_${idp.name}`] = info.getLinkUrl(idp.routes.login);
      body.links[`login_${idp.name}_sa`] = info.getLinkUrl(idp.routes.login, { selectAccount: true });
    }
  }

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

/**
 * Handles the auth route
 * @param {AdminContext} ctx the universal context
 * @param {PathInfo} info path info
 * @return {Promise<Response>} response
 */
export async function auth(ctx, info) {
  const {
    log, data, attributes: { authInfo }, suffix,
  } = ctx;

  if (suffix === '/auth/discovery/keys') {
    // deliver JWKS
    return new Response(JSON.stringify(localJWKS, null, 2), {
      status: 200,
      headers: {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'application/json; charset=utf-8',
      },
    });
  }

  // check if the route belongs to an idp
  for (const idp of IDPS) {
    if (suffix === idp.routes.login) {
      return redirectToLogin(ctx, info, idp, {
        noPrompt: true,
        loginHint: authInfo.loginHint,
      });
    }

    // handle /login/ack route
    if (suffix === idp.routes.loginRedirect) {
      try {
        data.state = decodeJwt(data.state);
      } catch (e) {
        log.warn(`login to ${idp.name} failed: invalid state: ${e.message}`);
      }
      if (!data.state) {
        return new Response('', {
          status: 401,
        });
      }
      data.extensionId = data.state.extensionId;
      data.org = data.state.org;
      data.site = data.state.site;

      // eslint-disable-next-line no-param-reassign
      info.org = data.org;
      // eslint-disable-next-line no-param-reassign
      info.site = data.site;

      if (!data.code) {
        if (data.state.prompt === 'none') {
          // login failed, but try again with prompt
          return redirectToLogin(ctx, info, idp, {
            noPrompt: false,
            loginHint: authInfo.loginHint,
            tenantId: data.state.tenantId,
          });
        }
        log.warn(`login to ${idp.name} failed: ${data.error}`);
        return new Response('', {
          status: 401,
        });
      }
      return exchangeToken(ctx, info, idp, data.state.tenantId);
    }
  }
  return new Response('', {
    status: 404,
  });
}
