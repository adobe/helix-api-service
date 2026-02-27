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
import { AbortError } from '@adobe/fetch';
import { StatusCodeError } from '../support/StatusCodeError.js';
import {HelixStorage} from "@adobe/helix-shared-storage";

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
 * @param {import('../support/AdminContext').AdminContext} ctx context
 * @param {string} contentBusId content bus id
 * @returns contents of `.hlx.json` or null
 */
export async function fetchHlxJson(ctx, contentBusId) {
  const storage = HelixStorage.fromContext(ctx);
  const buf = await storage.contentBus().get(`${contentBusId}/.hlx.json`);
  if (!buf) {
    return null;
  }
  return JSON.parse(buf.toString());
}

/**
 * Checks if "this" site's code source is the canonical source of this site.
 * If not, name of the primary code source is returned.
 * @param {AdminContext} ctx
 * @param {RequestInfo} info
 * @returns {string}
 */
export function checkCanonicalRepo(ctx, info) {
  if (!ctx.attributes.config?.code) {
    return '';
  }
  const { code } = ctx.attributes.config;
  const url = new URL(code.source.url);
  // only check for github repos
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    if (code.owner !== info.org || code.repo !== info.site) {
      return `${code.owner}/${code.repo}`;
    }
  }
  return '';
}
