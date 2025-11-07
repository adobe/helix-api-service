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
import { IndexConfig } from '@adobe/helix-shared-config';
import { contains } from '@adobe/helix-shared-indexer';
import { hasSimpleSitemap } from '../sitemap/utils.js';
import { getPackedMessageQueue, getSingleMessageQueue } from '../support/utils.js';

export const INTERNAL_SITEMAP_INDEX = '#internal-sitemap-index';

/**
 * checks if the current project site is authenticated and if so, creates a JWT token to
 * authenticated against the live site.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @returns {Promise<object>} the headers
 */
export async function getFetchHeaders(context) {
  const accessConfig = await context.getSiteAccessConfig('live');
  if (!accessConfig.allow.length
    && !accessConfig.apiKeyId.length
    && !accessConfig.secretId.length) {
    // site is not protected, no header needed
    return {};
  }
  return {
    authorization: `token ${context.env.HLX_GLOBAL_DELIVERY_TOKEN}`,
  };
}

/**
 * Canonicalize an index target path, removing any non-JSON extension and appending
 * JSON if necessary.
 *
 * @param {string} target target path
 * @returns JSON path of an index target or null if the target is undefined
 */
export function jsonPath(target) {
  if (!target) {
    return null;
  }
  if (target.endsWith('.json')) {
    return target.replace(/^s3:\/\//, '/');
  }
  const idx = target.lastIndexOf('.');
  if (idx === -1) {
    return `${target}.json`;
  }
  return `${target.substring(0, idx)}.json`;
}

/**
 * Return a flag indicating whether some path should be indexed.
 *
 * @param {import('@adobe/helix-shared-indexer').IndexConfig} index main index configuration
 */
export function shouldIndex(includeOther, ext) {
  if (ext === '.md') {
    return true;
  }
  if ((ext === '.pdf' || ext === '.json') && includeOther) {
    return true;
  }
  return false;
}

/**
 * Returns a flag indicating whether a path is contained in some index configuration
 *
 * @param {import('@adobe/helix-shared-indexer').IndexConfig} index main index configuration
 * @param {string} path path
 * @returns true if it contains a site configuration, false otherwise
 */
export function containsPath(index, path) {
  return index.indices.some((config) => contains(config, path));
}

/**
 * Determines whether an index configuration is a site index, featuring only
 * a simple subset of properties.
 *
 * @param {import('@adobe/helix-shared-indexer').Index} config a single index configuration
 * @returns true if it is a site configuration, false otherwise
 */
export function isSiteConfig(config) {
  return config.properties.every(({ name }) => ['lastModified', 'lastPublished', 'robots'].includes(name));
}

/**
 * Returns a flag indicating whether the index configuration contains some site config.
 *
 * @param {import('@adobe/helix-shared-indexer').IndexConfig} index main index configuration
 * @returns true if it contains a site configuration, false otherwise
 */
export function hasSiteConfig(index) {
  return index.indices.some((config) => isSiteConfig(config));
}

/**
 * Returns all index targets from an index definition.
 *
 * @returns {String[]} index targets, with JSON extension
 */
export function getIndexTargets(index) {
  return index.indices
    .map(({ target }) => target)
    .filter((target) => !!target)
    .map((target) => jsonPath(target));
}

/**
 * Add internal simple sitemap index to an index configuration
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('@adobe/helix-shared-config').IndexConfig} config indexer configuration
 * @returns {import('@adobe/helix-shared-config').IndexConfig} enhanced indexer configuration
 */
async function addSimpleSitemapIndex(context, info, config) {
  if (!await hasSimpleSitemap(context, info)) {
    return config;
  }

  const clone = await new IndexConfig().withSource(config?.toYAML() || '').init();
  clone.addIndex({
    name: INTERNAL_SITEMAP_INDEX,
    exclude: ['**.json', '**.pdf', '/drafts/**'],
    target: 's3://sitemap.json',
    properties: {
      lastModified: {
        select: 'none',
        value: 'parseTimestamp(headers["last-modified"], "ddd, DD MMM YYYY hh:mm:ss GMT")',
      },
    },
  });
  return new IndexConfig().withSource(clone.toYAML()).init();
}

/**
 * Fetch extended index configuration, including an internal site index.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {boolean} optional if {@code true}, no error is thrown if no config exists
 *
 * @returns {import('@adobe/helix-shared-config').IndexConfig} config or null
 */
export async function fetchExtendedIndex(context, info) {
  const { log } = context;

  let config = await context.fetchIndex(info);
  const errors = config?.getErrors();
  if (errors?.length) {
    const detail = errors.map(({ message }) => (message)).join('\n');
    log.warn(`Unable to add simple sitemap, index configuration contains errors:
      ${detail}`);
  } else {
    config = await addSimpleSitemapIndex(context, info, config);
  }
  return config;
}

/**
 * Returns the name of the queue that contains the messages that represent the index updates.
 * One message corresponds to one index entry (document) updated.
 *
 * @returns {string}
 */
export function getUpdatesQueue(region, accountId, test) {
  return getSingleMessageQueue(region, accountId, 'indexer', test);
}

/**
 * Returns the name of the queue that contains the task which cause the indexer to run. One message
 * corresponds to a batched collection of updates for a particular project.
 *
 * @type {string}
 */
export function getTasksQueue(region, accountId, test) {
  return getPackedMessageQueue(region, accountId, 'indexer', test);
}

/**
 * Return the index type to store when sending a message to the batched queue client.
 */
export function getIndexType(config, backendType) {
  return config.target?.startsWith('s3://') ? 'markup' : backendType;
}
