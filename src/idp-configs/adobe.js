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
export default {
  name: 'adobe',
  mountType: 'markup',
  client: (ctx) => ({
    clientId: ctx.env.HLX_ADMIN_APP_IMS_CLIENT_ID,
    clientSecret: ctx.env.HLX_ADMIN_APP_IMS_CLIENT_SECRET,
  }),
  scope: 'AdobeID openid profile email ab.manage gnav org.read read_organizations session additional_info.ownerOrg additional_info.projectedProductContext aem.frontend.all',
  discoveryUrl: 'https://ims-na1.adobelogin.com/ims/.well-known/openid-configuration',
  loginPrompt: 'login',
  // todo: fetch from discovery document
  discovery: {
    issuer: 'https://ims-na1.adobelogin.com',
    authorization_endpoint: 'https://ims-na1.adobelogin.com/ims/authorize/v2',
    token_endpoint: 'https://ims-na1.adobelogin.com/ims/token/v3',
    userinfo_endpoint: 'https://ims-na1.adobelogin.com/ims/userinfo/v2',
    revocation_endpoint: 'https://ims-na1.adobelogin.com/ims/revoke',
    jwks_uri: 'https://ims-na1.adobelogin.com/ims/keys',
  },
  routes: {
    login: '/auth/adobe',
    loginRedirect: '/auth/adobe/ack',
  },
};
