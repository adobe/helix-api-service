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
import crypto from 'crypto';
import { AdminConfigStore } from './admin-config-store.js';
import localJWKS from '../idp-configs/jwks-json.js';
import { errorResponse } from '../support/utils.js';
import { createErrorResponse } from '../contentbus/utils.js';

const OPERATIONS = {
  PUT: 'fetchCreate',
  GET: 'fetchRead',
  POST: 'fetchUpdate',
  DELETE: 'fetchRemove',
};

/**
 * Creates a new admin API JWT for the given org and site (name). Optionally sets the roles.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} org organization name
 * @param {string} site site name
 * @param {string[]} [roles] roles to assign
 * @returns {Promise<string>} JWT token
 */
async function createAdminJWT(context, org, site = '*', roles = ['author']) {
  const { env, log } = context;
  const privateKey = await importJWK(JSON.parse(env.HLX_ADMIN_IDP_PRIVATE_KEY), 'RS256');
  const publicKey = localJWKS.keys[0];
  const jti = crypto.randomBytes(33).toString('base64');

  const adminToken = await new SignJWT({
    email: 'helix@adobe.com',
    name: 'Helix Admin',
    roles,
  })
    .setProtectedHeader({
      alg: 'RS256',
      kid: publicKey.kid,
    })
    .setIssuedAt()
    .setIssuer(publicKey.issuer)
    .setAudience(env.HLX_SITE_APP_AZURE_CLIENT_ID)
    .setSubject(`${org}/${site}`)
    .setExpirationTime('365 days')
    .setJti(jti)
    .sign(privateKey);

  log.info(`created admin token for %s/%s with roles: ${roles}. apiKeyId=${jti}`, org, site);
  return adminToken;
}

const NAMES = [
  'versions',
  'tokens',
  'secrets',
  'users',
  'access',
  'groups',
  'apiKeys',
];

function determineConfigType(info) {
  const { webPath, route, ext } = info;
  if (webPath === undefined) {
    // either a request to the org config itself or its sites or its profiles
    const type = route !== 'config.json' ? route : undefined;
    return { type };
  }
  if (ext === '.json') {
    const [, name, ...rest] = webPath.substring(0, webPath.length - 5).split('/');
    if (NAMES.includes(name)) {
      rest.unshift(name);
      return { type: 'org', name: '', rest };
    }
  }
  return { rest: null };
}

export async function orgConfigHandler(context, info) {
  const { attributes: { authInfo }, data, log } = context;
  const { org, method } = info;

  const op = OPERATIONS[method];
  if (!op) {
    return errorResponse(log, 405, 'method not allowed');
  }
  if (op === 'fetchRead') {
    authInfo.assertPermissions('config:read');
  } else {
    authInfo.assertPermissions('config:write');
  }

  const { type, name, rest = [] } = determineConfigType(info);
  if (!rest) {
    return errorResponse(log, 404, 'invalid config type');
  }

  let store;
  try {
    store = new AdminConfigStore(org, type, name);
  } catch (e) {
    return createErrorResponse({ log, status: 400, msg: e.message });
  }
  if (authInfo.hasPermissions('config:ops')) {
    store.withAllowOps(true);
  }
  if (authInfo.hasPermissions('config:admin-acl')) {
    store.withAllowAdmin(true);
  }

  // POST to /.../apiKeys generate or import JWT
  if (op === 'fetchUpdate' && rest.at(-1) === 'apiKeys') {
    // only allow admins to set api keys
    authInfo.assertPermissions('config:admin-acl');
    if (!data.jwt) {
      data.jwt = await createAdminJWT(context, org, name, data.roles);
    }
  }

  const relPath = rest.join('/');
  return store[op](context, relPath);
}
