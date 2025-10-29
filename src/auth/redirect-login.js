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
import { UnsecuredJWT } from 'jose';
import { verifyClientInfo } from './clients.js';
import { clearAuthCookie } from './cookie.js';

/**
 * Returns a redirect (302) response to the IDPs login endpoint
 *
 * @param {AdminContext} ctx the universal context
 * @param {PathInfo} info path info
 * @param {IDPConfig} idp IDP config
 * @param {object} opts
 * @param {boolean} opts.noPrompt if {@code true}, force no prompt
 * @param {string} opts.loginHint login hint, i.e. email
 * @return {Promise<Response>} response
 */
export function redirectToLogin(ctx, info, idp, opts) {
  const { log, data } = ctx;

  let forwardedInfo;
  if (data.client_id) {
    const verifyResponse = verifyClientInfo(
      log,
      data.client_id,
      data.redirect_uri,
    );

    if (verifyResponse) {
      return verifyResponse;
    }

    forwardedInfo = {
      clientId: data.client_id,
      redirectUri: data.redirect_uri,
      state: data.state,
    };
  }

  const { noPrompt, loginHint, tenantId } = opts;
  let ap = idp.discovery.authorization_endpoint;
  if (ap.includes('{tenantid}')) {
    ap = ap.replace('{tenantid}', tenantId || 'common');
  }
  const url = new URL(ap);
  let prompt = noPrompt ? 'none' : '';
  if (data.selectAccount) {
    prompt = idp.loginPrompt;
  }
  const state = new UnsecuredJWT({
    prompt,
    // this is the id of the extension (sidekick)
    extensionId: data.extensionId,
    org: data.org || info.org,
    site: data.site || info.site,
    tenantId,
    // this is the client id, redirect uri and state of the client which initiated the login
    forwardedInfo,
  }).encode();
  url.searchParams.append('client_id', idp.client(ctx).clientId);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', idp.scope);
  url.searchParams.append('nonce', crypto.randomUUID());
  url.searchParams.append('state', state);
  url.searchParams.append('redirect_uri', info.getLinkUrl(idp.routes.loginRedirect));
  if (loginHint) {
    url.searchParams.append('login_hint', loginHint);
  }
  if (prompt) {
    url.searchParams.append('prompt', prompt);
  }

  log.info('redirecting to login page', url.href);
  return new Response('', {
    status: 302,
    headers: {
      'cache-control': 'no-store, private, must-revalidate',
      location: url.href,
      'set-cookie': clearAuthCookie(),
    },
  });
}
