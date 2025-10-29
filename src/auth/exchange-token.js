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
import { importJWK, SignJWT } from 'jose';
import { encode } from 'querystring';
import { Response } from '@adobe/fetch';
import { CLIENTS, verifyClientInfo } from './clients.js';
import {
  createCloseHtml, createSendMessageHtml, sendAEMCLILoginInfoResponse, createClientSideRedirectHtml,
} from './responses.js';
import {
  decodeIdToken, decodeImsToken, getProjectLinkUrl,
  getTransientSiteTokenInfo, PROFILE_PATH,
} from './support.js';
import { setAuthCookie } from './cookie.js';
import localJWKS from '../idp-configs/jwks-json.js';

async function fetchTokens(ctx, info, idp, tenantId) {
  const { data, log } = ctx;

  const fetch = ctx.getFetch();

  let te = idp.discovery.token_endpoint;
  if (te.includes('{tenantid}')) {
    te = te.replace('{tenantid}', tenantId || 'common');
  }

  const url = new URL(te);
  const client = idp.client(ctx);
  const body = {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code: data.code,
    grant_type: 'authorization_code',
    redirect_uri: info.getLinkUrl(idp.routes.loginRedirect),
  };
  log.info('exchanging token with %s via %s', idp.name, url.href);
  const res = await fetch(url.href, {
    method: 'POST',
    body: encode(body),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
  });
  if (!res.ok) {
    log.warn(`code exchange failed: ${res.status}`, await res.text());
    return {
      error: new Response('', {
        status: 401,
      }),
    };
  }

  const tokenResponse = await res.json();
  const { id_token: idToken, access_token: accessToken } = tokenResponse;

  return { idToken, accessToken };
}

async function decodeTokens(ctx, info, idp, tokens) {
  const { log } = ctx;
  const { idToken, accessToken } = tokens;

  const ret = { payload: {} };
  const { payload } = ret;

  try {
    const decoded = await decodeIdToken(ctx, info, idp, idToken);
    for (const prop of ['email', 'user_id', 'name', 'roles', 'oid', 'preferred_username']) {
      if (decoded[prop]) {
        payload[prop] = decoded[prop];
      }
    }

    // ims only
    if (!payload.user_id && decoded.sub?.indexOf('@') > 0) {
      payload.user_id = decoded.sub;
      payload.imsToken = accessToken;
      const decodedAccessToken = await decodeImsToken(ctx, info, idp, accessToken);
      const expiresIn = Math.floor(Number.parseInt(decodedAccessToken.expires_in, 10) / 1000);
      const createdAt = Math.floor(Number.parseInt(decodedAccessToken.created_at, 10) / 1000);

      ret.iat = createdAt;
      ret.exp = createdAt + expiresIn;
    }

    ret.picture = decoded.picture || '';
    ret.iss = decoded.iss;
    return ret;
  } catch (e) {
    log.warn(`id token from ${idp.name} is invalid: ${e.message}`);
    return {
      error: new Response('', {
        status: 401,
      }),
    };
  }
}

async function createExtensionResponse(ctx, info, idp, extensionId, {
  token, accessToken, decoded, state,
}) {
  const { log } = ctx;
  const { payload, iss, exp } = decoded;
  let { picture } = decoded;

  const fetch = ctx.getFetch();

  let siteTokenInfo = null;
  const email = payload.email || payload.user_id || payload.preferred_username;
  if (!email) {
    log.warn(`Decoded id token from ${iss} does not contain email: ${JSON.stringify(payload, 0, 2)}`);
  } else {
    siteTokenInfo = await getTransientSiteTokenInfo(ctx, info, email);
  }

  // fetch profile picture for microsoft
  if (idp.name === 'microsoft') {
    const resp = await fetch('https://graph.microsoft.com/v1.0/me/photos/48x48/$value', {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (resp.ok) {
      // read buffer so we can return it
      const buffer = await resp.buffer();
      const contentType = resp.headers.get('content-type') || 'image/png';
      if (buffer.length > 4096) {
        log.info(`ignoring profile picture (${contentType}) larger than 4k. is: ${buffer.length}`);
      } else {
        picture = `data:${contentType};base64,${buffer.toString('base64')}`;
      }
    } else {
      log.info(`unable to retrieve profile picture: ${resp.status} ${await resp.text()}`);
    }
  }

  log.debug(`login: creating extension html for ${extensionId}`);

  // deliver extension html
  const { org, site } = state;
  const msg = {
    action: 'updateAuthToken',
    authToken: token,
    owner: org,
    repo: site,
    picture,
    org,
    site,
    exp: exp * 1000,
  };
  if (siteTokenInfo) {
    Object.assign(msg, siteTokenInfo);
  }
  const html = createSendMessageHtml(extensionId, msg);
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      // don't send cookie
    },
  });
}

async function createAEMCLILoginInfoResponse(ctx, info, {
  forwardedInfo, decoded,
}) {
  const { log } = ctx;
  const { payload, iss } = decoded;

  // we are evaluating more secure ways to do this
  // for the moment we only support the AEM CLI, so we didn't overformalize
  let { redirectUri } = forwardedInfo;
  const { clientId, state } = forwardedInfo;

  const verifyResponse = verifyClientInfo(log, clientId, redirectUri);
  if (verifyResponse) {
    return verifyResponse;
  }
  const clientInfo = CLIENTS[clientId];

  redirectUri = redirectUri || clientInfo.defaultRedirectUri;

  let siteTokenInfo = null;
  if (!payload.email) {
    log.warn(`${clientId}: Decoded id token from ${iss} does not contain email: ${JSON.stringify(payload, 0, 2)}`);
    return new Response('', { status: 401 });
  } else {
    siteTokenInfo = await getTransientSiteTokenInfo(ctx, info, payload.email);
  }

  return sendAEMCLILoginInfoResponse(
    redirectUri,
    {
      state,
      siteToken: siteTokenInfo?.siteToken,
    },
  );
}

/**
 * Performs a token exchange from the code flow and redirects to the root page
 *
 * @param {AdminContext} ctx the universal context
 * @param {PathInfo} info path info
 * @param {IDPConfig} idp IDP config
 * @param {string} [tenantId] optional tenant id for the IDP
 * @return {Promise<Response>} response
 */
export async function exchangeToken(ctx, info, idp, tenantId) {
  const { log, data } = ctx;

  const tokens = await fetchTokens(ctx, info, idp, tenantId);
  if (tokens.error) {
    return tokens.error;
  }

  const decoded = await decodeTokens(ctx, info, idp, tokens);
  if (decoded.error) {
    return decoded.error;
  }

  const {
    payload = {},
    iat = Math.floor(Date.now() / 1000),
    exp = iat + (24 * 60 * 60), // 24 hours in seconds
  } = decoded;

  const { extensionId } = data.state;
  if (extensionId) {
    /*
      add the extension id in the token,
      so we can identify admin calls made by the sidekick and mitigate against CSRF
    */
    payload.extensionId = extensionId;
  }

  // create an admin JWT for that user
  const privateKey = await importJWK(JSON.parse(ctx.env.HLX_ADMIN_IDP_PRIVATE_KEY), 'RS256');
  const publicKey = localJWKS.keys[0];
  const token = await new SignJWT(payload)
    .setProtectedHeader({
      alg: 'RS256',
      kid: publicKey.kid,
    })
    .setIssuedAt(iat)
    .setIssuer(publicKey.issuer)
    .setSubject('*/*')
    .setAudience(ctx.env.HLX_SITE_APP_AZURE_CLIENT_ID)
    .setExpirationTime(exp)
    .sign(privateKey);

  // ensure that auth cookie is not cleared again in `index.js`
  ctx.attributes.authInfo?.withCookieInvalid(false);

  // if a extensionId is provided, we send the token via sendmessage
  if (extensionId === 'cookie') {
    log.debug('login: sending close window HTML with cookie');
    return new Response(createCloseHtml(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, private, must-revalidate',
        'set-cookie': setAuthCookie(token),
      },
    });
  }

  if (extensionId) {
    return createExtensionResponse(ctx, info, idp, extensionId, {
      token, accessToken: tokens.accessToken, decoded, state: data.state,
    });
  }

  const { forwardedInfo } = data.state;
  if (forwardedInfo?.clientId === 'aem-cli') {
    return createAEMCLILoginInfoResponse(ctx, info, {
      forwardedInfo, decoded,
    });
  }

  const location = getProjectLinkUrl(ctx, info, PROFILE_PATH, '');
  log.debug('login: redirecting to profile page with id_token cookie', location);
  return new Response(createClientSideRedirectHtml(location), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'set-cookie': setAuthCookie(token),
    },
  });
}
