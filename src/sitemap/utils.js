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

export const INTERNAL_SITEMAP = '#internal-sitemap';

/**
 * Returns all destinations from a sitemap definition.
 *
 * @param {import('@adobe/helix-shared-config').SitemapConfig} sitemap configuration
 * @returns {Array<String>} destinations
 */
export function getDestinations(sitemap) {
  const destinations = [];
  if (sitemap) {
    sitemap.sitemaps.forEach((s) => {
      if (s.languages) {
        destinations.push(...s.languages.map(({ destination }) => destination));
      } else {
        destinations.push(s.destination);
      }
    });
  }
  // return unique results
  return destinations.filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * Returns a flag indicating whether a simple sitemap was just added to a project.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {boolean} verbose whether to inform about decisions
 * @returns true or false
 */
export async function installSimpleSitemap(context, info, verbose) {
  const { contentBusId, log } = context;
  const { org, site } = info;
  const level = verbose ? 'info' : 'debug';

  let sitemapConfig;

  try {
    sitemapConfig = await context.fetchSitemap(info);
  } catch (e) {
    log.info(`Unable to fetch sitemap configuration: ${e.message}`);
    return false;
  }

  if (sitemapConfig) {
    log[level]('Explicitly defined sitemap configuration found, will not install simple sitemap.');
    return false;
  }
  const contentBus = HelixStorage.fromContext(context).contentBus();

  const key = `${contentBusId}/live/sitemap.json`;
  if (await contentBus.head(key) !== null) {
    log[level](`Simple sitemap source found: ${key}, will not install simple sitemap.`);
    return false;
  }

  // install an empty array in live, this will trigger the rest
  await contentBus.put(key, JSON.stringify({ data: [] }), 'application/json');
  log.info(`Installed simple sitemap in: ${org}/${site}`);
  return true;
}

/**
 * Returns a flag indicating whether the project has a simple sitemap.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns true or false
 */
export async function hasSimpleSitemap(context, info) {
  const { contentBusId, log } = context;
  let sitemapConfig;

  try {
    sitemapConfig = await context.fetchSitemap(info);
  } catch (e) {
    log.warn(`Unable to fetch sitemap configuration: ${e.message}`);
    return false;
  }

  if (sitemapConfig) {
    log.debug('Explicitly defined sitemap configuration found');
    return false;
  }
  const contentBus = HelixStorage.fromContext(context).contentBus();

  const key = `${contentBusId}/live/sitemap.json`;
  if (await contentBus.head(key) === null) {
    log.debug(`Simple sitemap source not found: ${key}`);
    return false;
  }
  return true;
}

/**
 * Fetch extended sitemap configuration. This either returns:
 * - the contents of `helix-sitemap.yaml`
 * - a simple sitemap when prerequisites are met
 * - null
 *
 * @param {import('@adobe/helix-universal').UniversalContext} context context
 * @param {import('../support/PathInfo').PathInfo} info path info
 * @returns {import('@adobe/helix-shared-config').SitemapConfig} config or null
 */
export async function fetchExtendedSitemap(context, info) {
  const { log } = context;
  let sitemapConfig;

  try {
    sitemapConfig = await context.fetchSitemap(info);
  } catch (e) {
    log.warn(`Unable to fetch sitemap configuration: ${e.message}`);
    return null;
  }
  if (sitemapConfig) {
    return sitemapConfig;
  }
  if (!await hasSimpleSitemap(context, info)) {
    return null;
  }
  sitemapConfig = await new SitemapConfig().withSource('').init();
  sitemapConfig.addSitemap({
    name: INTERNAL_SITEMAP,
    source: '/sitemap.json',
    destination: '/sitemap.xml',
  });
  return new SitemapConfig().withSource(sitemapConfig.toYAML()).init();
}
