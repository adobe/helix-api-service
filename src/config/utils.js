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
import { AbortError } from '@adobe/fetch';
import { HelixStorage } from '@adobe/helix-shared-storage';
import localJWKS from '../idp-configs/jwks-json.js';
import { StatusCodeError } from '../support/StatusCodeError.js';

/**
 * Load configuration from the config service.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} url where to load it from
 * @param {string} type what kind of configuration
 * @returns {Promise<object|null>} configuration or null
 */
async function loadConfig(context, url, type) {
  const { log, env } = context;
  const fetch = context.getFetch();

  const fopts = context.getFetchOptions();
  fopts.headers['x-access-token'] = env.HLX_CONFIG_SERVICE_TOKEN;
  fopts.headers['x-backend-type'] = 'aws';

  try {
    const response = await fetch(url, fopts);
    const { ok, status } = response;
    if (ok) {
      log.info(`loaded ${type} config from ${url}`);
      const config = await response.json();
      return config;
    }
    if (status !== 404) {
      log.warn(`error loading ${type} config from ${url}: ${response.status}`);
    }
    return null;
  } catch (e) {
    const msg = `Fetching ${type} config from ${url} failed: ${e.message}`;
    throw new StatusCodeError(msg, e instanceof AbortError ? 504 : /* c8 ignore next */ 502);
    /* c8 ignore next 5 */
  } finally {
    if (fopts.signal) {
      fopts.signal.clear();
    }
  }
}

export async function loadSiteConfig(context, org, site) {
  const url = `https://config.aem.page/main--${site}--${org}/config.json?scope=admin`;
  return loadConfig(context, url, 'site');
}

export async function loadOrgConfig(context, org) {
  const url = `https://config.aem.page/${org}/config.json?scope=admin`;
  return loadConfig(context, url, 'org');
}

/**
 * Returns a list of paths with admin roles. Checks any paths that start with
 * `/groups/`.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @returns {Promise<string[]>}
 */
export async function getUserListPaths(context) {
  const { config } = context;
  const paths = new Set();

  for (const users of Object.values(config.access?.admin?.role ?? {})) {
    for (const user of users) {
      if (user.startsWith('/') && !user.startsWith('/groups/')) {
        paths.add(user);
      }
    }
  }
  return Array.from(paths);
}

/**
 * Return the contents of the `.hlx.json` file in a project.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} contentBusId content bus id
 * @returns {Promise<object|null>} contents of `.hlx.json` or null
 */
export async function fetchHlxJson(context, contentBusId) {
  const storage = HelixStorage.fromContext(context);
  const buf = await storage.contentBus().get(`${contentBusId}/.hlx.json`);
  if (!buf) {
    return null;
  }
  return JSON.parse(buf.toString());
}

/**
 * Checks if "this" site is the primary site and returns an empty string. otherwise the
 * name of the primary site is returned.
 * @param {import('../support/AdminContext').AdminContext} context
 * @param {string} contentBusId
 * @param {import('../support/RequestInfo').RequestInfo} info
 * @returns {Promise<string>} empty string if "this" site is the primary site,
 * otherwise the name of the primary site
 */
export async function checkPrimarySite(context, contentBusId, info) {
  const { org, site } = info;

  const hlx = await fetchHlxJson(context, contentBusId);
  const project = `${org}/${site}`;
  const primary = hlx?.['original-site'] ?? hlx?.['original-repository'] ?? 'n/a';

  return primary === project ? '' : primary;
}

/**
 * Checks if "this" site's code source is the canonical source of this site.
 * If not, name of the primary code source is returned.
 * @param {import('../support/AdminContext').AdminContext} context
 * @param {import('../support/RequestInfo').RequestInfo} info
 * @returns {string}
 */
export function checkCanonicalRepo(context, info) {
  const { config: { code } } = context;
  const url = new URL(code.source.url);
  // only check for github repos
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    if (code.owner !== info.org || code.repo !== info.site) {
      return `${code.owner}/${code.repo}`;
    }
  }
  return '';
}

/**
 * Creates a new admin API JWT for the given org and site (name). Optionally sets the roles.
 *
 * @param {import('../support/AdminContext.js').AdminContext} context context
 * @param {string} org organization name
 * @param {string} site site name
 * @param {string[]} [roles] roles to assign
 * @returns {Promise<string>} JWT token
 */
export async function createAdminJWT(context, org, site = '*', roles = ['author']) {
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
