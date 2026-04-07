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
import { SitemapConfig } from '@adobe/helix-shared-config';

import { HelixStorage } from '@adobe/helix-shared-storage';
import SitemapBuilder from './SitemapBuilder.js';

export default {
  /**
   * Triggered when the production hostname for a project changes.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {Object} host changed host
   * @returns {Promise<boolean>}
   */
  hostUpdated: async (context, info, host) => {
    const { attributes, contentBusId, log } = context;
    const fetchTimeout = 5000;

    if (!host.new) {
      log.info('No new hostname provided, ignoring CDN prod host update');
      return false;
    }

    let config;

    try {
      config = await context.fetchSitemap(info);
      if (!config) {
        return false;
      }
    } catch (e) {
      log.info(`Unable to fetch sitemap configuration: ${e.message}`);
      return false;
    }

    const storage = HelixStorage.fromContext(context).contentBus();
    if (config['auto-generated'] === true) {
      const newOrigin = `https://${host.new}`;
      const oldOrigin = config.sitemaps[0]?.origin;

      if (newOrigin !== oldOrigin) {
        const clone = await new SitemapConfig().withSource(config.toYAML()).init();
        for (const sitemap of clone.sitemaps) {
          clone.setOrigin(sitemap.name, newOrigin);
        }

        const key = `/${contentBusId}/preview/.helix/sitemap.yaml`;
        await storage.put(key, clone.toYAML(), 'text/yaml; charset=utf-8');
        attributes.sitemapConfig = await new SitemapConfig().withSource(clone.toYAML()).init();

        log.info(`Stored generated sitemap configuration in: ${key}`);
      }
    }

    // generate new sitemaps
    await Promise.allSettled(config.sitemaps.map(async (sitemap) => {
      try {
        const builder = new SitemapBuilder({ config: sitemap });
        await builder.build(context, fetchTimeout);
        const result = await builder.store(context, true);

        log.info(`Sitemap for ${config.name} rebuilt: ${result.paths}.`);
      } catch (e) {
        log.warn(`Unable to generate sitemap: ${e.message}`);
      }
    }));
    return true;
  },
};
