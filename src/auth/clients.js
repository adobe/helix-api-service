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

// the 'aud' claim in a bearer token needs to match our client id (exported for testing)
export const ADMIN_CLIENT_ID = '452733d4-6ae5-4590-8d0f-27404a03aca8';

// the 'aud' claim in a api key token needs to match our client id (exported for testing)
export const SITE_CLIENT_ID = '83a36355-ad17-4ed0-8701-e99a3020f86a';

export const CLIENTS = {
  'aem-cli': {
    clientId: 'aem-cli',
    defaultRedirectUri: 'http://localhost:3000/.aem/cli/login/ack',
    isValidRedirectUri: (u) => {
      const url = new URL(u);
      return ['http:', 'https:'].includes(url.protocol)
        && url.hostname === 'localhost'
        && url.pathname === '/.aem/cli/login/ack';
    },
  },
};

export function verifyClientInfo(log, clientId, redirectUri) {
  const failedResponse = new Response('', { status: 401 });
  const clientInfo = CLIENTS[clientId];
  if (!clientInfo) {
    log.warn(`login failed: client: ${clientId}: unknown client`);
    return failedResponse;
  }

  // eslint-disable-next-line no-param-reassign
  redirectUri = redirectUri || clientInfo.defaultRedirectUri;
  if (!clientInfo.isValidRedirectUri(redirectUri)) {
    log.warn(`login failed: client: ${clientId}: invalid redirect_uri: ${redirectUri}`);
    return failedResponse;
  }

  return null;
}
