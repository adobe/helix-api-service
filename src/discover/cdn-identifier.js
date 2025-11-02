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
import { HelixStorage } from '@adobe/helix-shared-storage';
import { Inventory } from './inventory.js';

/**
 * Generators to create identifiers for production CDN configuration.
 */
const CDN_IDENTIFIERS = {
  akamai: (config) => `akamai:${config.endpoint}`,
  cloudflare: (config) => `cloudflare:${config.zoneId}`,
  cloudfront: (config) => `cloudfront:${config.distributionId}`,
  fastly: (config) => `fastly:${config.serviceId}`,
  managed: (config) => `managed:${config.envId || config.host}`,
};

/**
 * Generate a comparable identifier for a production CDN configuration that allows to eliminate
 * duplicate configurations, e.g. 2 Fastly services with the same service id.
 * @param {import('@adobe/helix-admin-support').ProjectConfig} config project configuration
 * @returns {String} unique identifier or null
 */
export function generate(config) {
  const { cdn: { prod } = {} } = config;
  if (prod) {
    const fn = CDN_IDENTIFIERS[prod.type];
    if (fn) {
      return fn(prod);
    }
  }
  return null;
}

/**
 * @typedef ProductionSite
 * @param {String} org site org
 * @param {String} site site
 */

/**
 * Return all sites having the same `codeBusId` as the current in `info`. The current
 * site is not returned in the response.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<ProductionSite[]>} list of org/site that match
 */
export async function querySiblingSites(ctx, info) {
  const { log } = ctx;
  const { owner, repo } = info;
  const codeBusId = `${owner}/${repo}`;

  const inventory = new Inventory(log, HelixStorage.fromContext(ctx).contentBus());
  if (!await inventory.load()) {
    log.warn('Inventory not available');
    return [];
  }
  return Array.from(inventory.entries()
    .filter((entry) => entry.codeBusId === codeBusId)
    .filter((entry) => !(entry.org === info.org && entry.site === info.site))
    .reduce((result, current) => {
      const { cdnId, org, site } = current;
      if (cdnId && !result.has(cdnId)) {
        result.set(cdnId, { org, site });
      }
      return result;
    }, new Map())
    .values());
}
