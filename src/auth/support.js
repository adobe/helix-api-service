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
import { Agent } from 'node:https';
import {
  createLocalJWKSet, createRemoteJWKSet,
  customFetch, decodeJwt, errors, jwtVerify,
  importJWK, SignJWT,
} from 'jose';

import { AbortController } from '@adobe/fetch';

import idpMicrosoft from '../idp-configs/microsoft.js';
import idpAdmin from '../idp-configs/admin.js';
import idpGoogle from '../idp-configs/google.js';
import idpAdobe from '../idp-configs/adobe.js';
import idpAdobeStage from '../idp-configs/adobe-stg.js';
import idpIms from '../idp-configs/ims.js';
import idpImsStage from '../idp-configs/ims-stg.js';
import { AuthInfo } from './auth-info.js';
import { ADMIN_CLIENT_ID } from './clients.js';
import { getAuthCookie } from './cookie.js';
import { RoleMapping } from './role-mapping.js';

export const LOGIN_PATH = '/login';
export const PROFILE_PATH = '/profile';
export const LOGOUT_PATH = '/logout';

const IMS_IDPS = [
  idpIms,
  idpImsStage,
];

export const IDPS = [
  idpGoogle,
  idpMicrosoft,
  idpAdobe,
  idpAdobeStage,
];

export const BEARER_IDP = {
  default: /** @type {import('./auth.d.ts').IDPConfig} */ idpMicrosoft,
  token: /** @type {import('./auth.d.ts').IDPConfig} */ idpAdmin,
};

const EXPIRE_TIMESPAN_SECS = 30 * 24 * 60 * 60;

/**
 * Workaround to define our own AbortSignal
 * @param adobeFetch
 * @returns {function(*, {}=): *}
 */
function globalFetchAdapter(adobeFetch) {
  return (url, options = {}) => {
    if (options.signal) {
      const controller = new AbortController();
      options.signal.addEventListener('abort', controller.abort.bind(controller));
      // eslint-disable-next-line no-param-reassign
      options = {
        ...options,
        signal: controller.signal,
      };
    }
    return adobeFetch(url, options);
  };
}

/**
 * Decodes the given id_token for the given idp. if `lenient` is `true`, the clock tolerance
 * is set to 1 week. this allows to extract some profile information that can be used as login_hint.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('./auth.d.ts').IDPConfig} idp
 * @param {string} idToken
 * @returns {Promise<import('jose').JWTPayload>}}
 */
export async function decodeIdToken(context, idp, idToken, opts = {}) {
  const { log } = context;
  const jwks = idp.discovery.jwks
    ? createLocalJWKSet(idp.discovery.jwks)
    : createRemoteJWKSet(new URL(idp.discovery.jwks_uri), {
      agent: new Agent({}),
      [customFetch]: globalFetchAdapter(context.getFetch()),
    });

  const { type = 'token' } = opts;
  const { payload } = await jwtVerify(idToken, jwks, {
    audience: idp.client(context).clientId,
  });

  const validate = idp.validateIssuer ?? ((iss) => (iss) === idp.discovery.issuer);
  if (!validate(payload.iss)) {
    throw new errors.JWTClaimValidationFailed('unexpected "iss" claim value', 'iss', 'check_failed');
  }
  const display = `...${idToken.slice(-4)}`;
  const epoch = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp - epoch < EXPIRE_TIMESPAN_SECS && payload.jti) {
    log.warn(`auth: ${type} for ${payload.sub} (${display}) will expire within 30 days: ${new Date(payload.exp * 1000).toISOString()}`);
  } else {
    log.info(`auth: ${type} for ${payload.sub} (${display}) accepted`);
  }

  // delete from information not needed in the profile
  ['azp', 'at_hash', 'nonce', 'aio', 'c_hash'].forEach((prop) => delete payload[prop]);

  // compute ttl
  payload.ttl = payload.exp - Math.floor(Date.now() / 1000);

  log.info(`decoded id_token from ${payload.iss} and validated payload.`);
  return payload;
}

/**
 * Decodes the given IMS Access token for the given idp.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('./auth.d.ts').IDPConfig} idp
 * @param {string} idToken
 * @returns {Promise<import('jose').JWTPayload>}}
 */
export async function decodeImsToken(context, idp, idToken) {
  const { log } = context;
  const jwks = idp.discovery.jwks
    ? createLocalJWKSet(idp.discovery.jwks)
    /* c8 ignore next */
    : createRemoteJWKSet(new URL(idp.discovery.jwks_uri));

  const { payload } = await jwtVerify(idToken, jwks);

  if (payload.type !== 'access_token') {
    throw new errors.JWTClaimValidationFailed('unexpected "type" claim value', 'type', 'check_failed');
  }

  // currently we only allow the xwalk client to access the admin api
  if (!payload.scope) {
    throw new errors.JWTClaimValidationFailed('unexpected "scope" claim value', 'scope', 'check_failed');
  }

  // check for admin scopes
  const scopes = payload.scope.split(',');
  // add scope until cm-repo-service includes it
  if (payload.client_id === 'cm-repo-service') {
    scopes.push('aem.backend.all');
    payload.roles = ['develop'];
  }

  if (!scopes.includes('aem.backend.all') && !scopes.includes('aem.frontend.all')) {
    throw new errors.JWTClaimValidationFailed('"scope" claim value is missing required scope.', 'scope', 'check_failed');
  }

  // validate expiration
  const now = Date.now();
  const expiresIn = Number.parseInt(payload.expires_in, 10);
  if (Number.isNaN(expiresIn)) {
    throw new errors.JWTClaimValidationFailed('"expires_in" claim must be a number', 'expires_in', 'invalid');
  }
  const createdAt = Number.parseInt(payload.created_at, 10);
  if (Number.isNaN(createdAt)) {
    throw new errors.JWTClaimValidationFailed('"created_at" claim must be a number.', 'created_at', 'invalid');
  }
  if (createdAt >= now) {
    throw new errors.JWTClaimValidationFailed('"created_at" claim timestamp check failed (it should be in the past)', 'created_at', 'check_failed');
  }
  payload.ttl = Math.floor((createdAt + expiresIn - now) / 1000);
  if (payload.ttl <= 0) {
    throw new errors.JWTExpired('"expires_in" claim timestamp check failed', 'expires_in', 'check_failed');
  }

  // map user_id to email
  payload.email = payload.user_id;

  // set default role for IMS users to publish instead of basic_publish
  if (scopes.includes('aem.backend.all')) {
    payload.defaultRole = 'publish';
  } else {
    delete payload.defaultRole;
  }

  // delete from information not needed in the profile
  ['id', 'type', 'as_id', 'ctp', 'pac', 'rtid', 'moi', 'rtea', 'user_id', 'fg', 'aa_id'].forEach((prop) => delete payload[prop]);

  log.info(`decoded access_token from ${payload.as}/${payload.client_id} and validated payload.`);
  return payload;
}

/**
 * find the idp that issued the token. currently only supports IMS tokens that have the idp
 * name in the `as` claim. defaults to the 'microsoft' idp.
 *
 * @param {string} token token
 * @returns {Promise<import('./auth.d.ts').IDPConfig>}
 */
export async function detectTokenIDP(token) {
  const payload = decodeJwt(token);
  return IMS_IDPS.find(({ name }) => name === payload.as) || BEARER_IDP.default;
}

/**
 * Returns the site auth token if the project is configured as such.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} partition partition
 * @returns {Promise<string|null>} the auth token
 */
export async function getSiteAuthToken(context, partition) {
  const accessConfig = await context.getSiteAccessConfig(partition);

  if (!accessConfig.allow.length
    && !accessConfig.apiKeyId.length
    && !accessConfig.secretId.length) {
    return null;
  }
  if (!accessConfig.token) {
    // for helix5, use the global token
    if (context.attributes.config) {
      accessConfig.token = context.env.HLX_GLOBAL_DELIVERY_TOKEN;
    }
  }
  return accessConfig.token;
}

/**
 * Returns the transient site auth token information for helix5 project with enabled auth.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} email email for which the token is generated
 * @param {number} tokenExpiry token expiry duration in millis
 * @returns {Promise<object|null>}
 */
export async function getTransientSiteTokenInfo(context, info, email, tokenExpiry) {
  const { attributes: { config } } = context;

  // get access config
  const allowPreview = config.access?.preview?.allow ?? [];
  const allowLive = config.access?.live?.allow ?? [];
  // eslint-disable-next-line max-len
  const apiKeyIdPreview = config.access?.preview?.apiKeyId ?? config.access?.preview?.secretId ?? [];
  const apiKeyIdLive = config.access?.live?.apiKeyId ?? config.access?.live?.secretId ?? [];

  // if no access is configured, return null
  if (allowPreview.length + allowLive.length + apiKeyIdPreview.length + apiKeyIdLive.length === 0) {
    return null;
  }

  try { // get admin access config
    const roleMapping = await RoleMapping.create(config.access.admin);
    roleMapping.withDefaultRoles([]); // ensure that 'anonymous' doesn't have read rights
    roleMapping.hasConfigured = true;
    for (const user of allowPreview) {
      roleMapping.add('site_preview', user);
    }
    roleMapping.add('site_preview', 'helix@adobe.com');

    for (const user of allowLive) {
      roleMapping.add('site_live', user);
    }

    const roles = roleMapping.getRolesForUser(email);
    const authInfo = AuthInfo.Default()
      .withRoles(roles);

    // authors can access preview, publishers can access live
    let domain;
    if (authInfo.hasPermissions('preview:read')) {
      // users that can read the preview and also create the live site
      domain = 'aem.page';
    } else if (authInfo.hasPermissions('live:read')) {
      domain = 'aem.live';
    } else {
      // indicate that the user is not allowed to access the site.
      context.log.info('unable to create transient site token: user not allowed to access the site.');
      return null;
    }

    const privateKeyJson = JSON.parse(context.env.HLX_ADMIN_TST_PRIVATE_KEY);
    const privateKey = await importJWK(privateKeyJson, 'RS256');
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const siteTokenExpiry = Date.now() + (tokenExpiry || ONE_DAY);
    const siteToken = await new SignJWT({})
      .setProtectedHeader({
        alg: 'RS256',
        kid: privateKey.kid,
      })
      .setAudience(`${info.site}--${info.org}.${domain}`)
      .setSubject(email)
      .setExpirationTime(Math.floor(siteTokenExpiry / 1000))
      .sign(privateKey);

    return {
      siteToken: `hlxtst_${siteToken}`,
      siteTokenExpiry,
    };
  } catch (e) {
    context.log.warn(`failed to generate transient site tokens: ${e.message}`);
    return null;
  }
}

/**
 * Computes the authentication info.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<AuthInfo>} the authentication info or null if the request is not authenticated
 */
export async function getAuthInfo(context, info) {
  const { log } = context;

  let authType;
  let token;

  const cookie = getAuthCookie(info);
  if (cookie) {
    authType = 'token';
    token = cookie;
  } else if (info.headers['x-auth-token']) {
    authType = 'token';
    token = info.headers['x-auth-token'];
  } else {
    [authType, token] = (info.headers?.authorization || '').split(' ');
  }

  if (authType.toLowerCase() === 'bearer') {
    try {
      const idp = await detectTokenIDP(token);
      if (idp.ims) {
        const profile = await decodeImsToken(context, idp, token);
        if (!profile.email) {
          log.warn('auth: ims token invalid: missing user id');
          return AuthInfo.Default();
        }
        log.info(`auth: ims token valid for user: '${profile.email}'`);
        return AuthInfo.Default()
          .withProfile(profile)
          .withIdp(idp)
          .withImsToken(token)
          .withAuthenticated(true);
      }
      const profile = await decodeIdToken(context, idp, token, {
        type: 'bearer token',
      });
      if (profile.aud === ADMIN_CLIENT_ID) {
        log.info(`auth: bearer token valid. roles: ${profile.roles}`);
        return AuthInfo.Default()
          .withProfile(profile)
          .withIdp(idp)
          .withAuthenticated(true);
      }
      log.info(`auth: bearer token has unknown audience. ignoring: ${profile.aud}`);
    } catch (e) {
      log.warn(`auth: bearer token not valid. ignoring: ${e.message}`);
    }
  }

  if (authType.toLowerCase() === 'token') {
    try {
      const idp = BEARER_IDP.token;
      const profile = await decodeIdToken(context, idp, token, {
        type: 'api token',
      });

      // validate subject claim
      if (!profile.sub) {
        log.warn('auth: api token invalid: missing "sub" claim');
        return AuthInfo.Default();
      }
      const [subOrg, subSite] = profile.sub.split('/');
      if (info.org && subOrg !== '*' && subOrg !== info.org) {
        log.warn(`auth: api token invalid: subject ${profile.sub} does not match ${info.org}/${info.site}`);
        return AuthInfo.Default();
      }
      if (info.site && subSite !== '*' && subSite !== info.site) {
        log.warn(`auth: api token invalid: subject ${profile.sub} does not match ${info.org}/${info.site}`);
        return AuthInfo.Default();
      }

      // validate that apiKeyId is configured for the project
      // or org (but not for wildcard org tokens)
      if (profile.jti && info.org && subOrg !== '*') {
        // TODO: seems helix4 specific, REMOVE?
        // let { configAll } = context.attributes;
        // if (!configAll && info.site) {
        //   configAll = await loadConfigSite(context, { ...info, route: 'preview' });
        // }
        // if (!configAll) {
        // eslint-disable-next-line max-len
        //   log.warn(`auth: api token invalid: jti ${profile.jti} could not be validated. no config for ${info.org}/${info.site || '*'}.`);
        //   return AuthInfo.Default();
        // }

        const { attributes: { config, orgConfig } } = context;
        const apiKeyId = config?.access?.admin?.apiKeyId || orgConfig?.access?.admin?.apiKeyId;
        if (apiKeyId.indexOf(profile.jti) < 0) {
          log.warn(`auth: api token invalid: jti ${profile.jti} does not match configured id [${apiKeyId}] in ${info.org}/${info.site || '*'}`);
          return AuthInfo.Default();
        }
      }

      // for api keys with wildcard org (*), check JTI against allow list in ctx.env
      if (profile.jti && subOrg === '*' && info.org) {
        const allowList = context.env.HLX_GLOBAL_API_KEY_ALLOWLIST;
        const allowedJtis = allowList ? allowList.split(',').map((jti) => jti.trim()) : [];

        if (!allowedJtis.includes(profile.jti)) {
          log.warn(`auth: api token invalid: jti ${profile.jti} with wildcard org not in allow list`);
          return AuthInfo.Default();
        }

        log.info(`auth: api token with wildcard org validated against allow list: jti ${profile.jti}`);
      }

      // remove confusing properties from the profile
      const authToken = profile.jti ? null : token;
      const extensionId = profile.extensionId ? profile.extensionId : null;
      const imsToken = profile.imsToken ? profile.imsToken : null;
      ['sub', 'jti', 'hlx_hash', 'picture', 'extensionId', 'imsToken'].forEach((prop) => delete profile[prop]);

      log.info(`auth: api token valid. roles: '${profile.roles}' scopes: '${profile.scopes}'`);
      return AuthInfo.Default()
        .withProfile(profile)
        .withIdp(idp)
        .withAuthToken(authToken)
        .withExtensionId(extensionId)
        .withImsToken(imsToken)
        .withAuthenticated(true);
    } catch (e) {
      log.warn(`auth: api token not valid. ignoring: ${e.message}`);
    }
  }

  log.info('auth: no auth cookie or bearer token. using default role');
  return AuthInfo.Default().withCookieInvalid(!!cookie);
}
