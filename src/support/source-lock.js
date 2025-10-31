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
import { StatusCodeError } from './StatusCodeError.js';

const sourceLock = {
  /**
   * Evaluates the source lock configuration and checks if the given site is allowed to use the
   * respective mountpoint.
   *
   * @param {import('./support/AdminContext').AdminContext} context context
   * @param {string} org org
   * @param {string} site site
   * @param {URL} url the source url
   * @returns {Promise<{reason: string, allowed: boolean}>}
   */
  evaluateUrl: async (context, org, site, url) => {
    const {
      log,
      env: {
        HLX_CONTENT_SOURCE_LOCK: lockJson,
      },
    } = context;
    if (!lockJson) {
      return {
        allowed: true,
        reason: 'no lock config',
      };
    }
    try {
      const lock = JSON.parse(lockJson);
      const sites = lock[url.hostname];
      if (!sites) {
        return {
          allowed: true,
          reason: 'no lock info for site',
        };
      }
      for (const project of sites) {
        const [lockOrg, lockSite] = project.split('/');
        if (lockOrg === org && (lockSite === '*' || lockSite === site)) {
          return {
            allowed: true,
            reason: 'site allowed by lock',
          };
        }
      }
      return {
        allowed: false,
        reason: `access for ${org}/${site} to ${url.hostname} denied by tenant lock`,
      };
    } catch (e) {
      log.warn(`error evaluating tenant lock for ${org}/${site}`, e);
      return {
        allowed: true,
        reason: 'error evaluating tenant lock',
      };
    }
  },

  /**
   * Evaluates the source lock configuration and checks if the given site is allowed to use the
   * respective mountpoint.
   *
   * @param {import('./support/AdminContext').AdminContext} context context
   * @param {string} org org
   * @param {string} site site
   * @returns {Promise<{reason: string, allowed: boolean}>}
   */
  evaluate: async (context, org, site) => {
    const { attributes: { config: { content } } } = context;
    const {
      log,
      env: {
        HLX_CONTENT_SOURCE_LOCK: lockJson,
      },
    } = context;
    if (!lockJson) {
      return {
        allowed: true,
        reason: 'no lock config',
      };
    }
    try {
      const url = new URL(content.source.url);
      return sourceLock.evaluateUrl(context, org, site, url);
    } catch (e) {
      log.warn(`error evaluating tenant lock for ${org}/${site}`, e);
      return {
        allowed: true,
        reason: 'error evaluating tenant lock',
      };
    }
  },

  /**
   * Enforces the source lock for the given site.
   *
   * @param {import('./support/AdminContext').AdminContext} context context
   * @param {string} org org
   * @param {string} site site
   * @returns {Promise<void>}
   */
  assert: async (context, org, site) => {
    const { log } = context;

    const { allowed, reason } = await sourceLock.evaluate(context, org, site);
    if (!allowed) {
      log.error(reason);
      throw new StatusCodeError('Access denied', 403);
    }
  },
};

export default sourceLock;
