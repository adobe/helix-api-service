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
import { BatchedQueueClient } from '@adobe/helix-admin-support';
import { IndexConfig } from '@adobe/helix-shared-config';
import { contains } from '@adobe/helix-shared-indexer';
import processQueue from '@adobe/helix-shared-process-queue';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { getDefaultSheetData } from '../contentproxy/utils.js';
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

/**
 * Sends the index results to our SQS queue.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object[]} results index results
 * @param {object} properties additional properties to add to every message
 *
 * @returns {Promise<void>}
 */
export async function sendToQueue(context, info, results, properties) {
  const { log, runtime: { region, accountId } } = context;
  const { org, site, webPath } = info;

  const queueClient = new BatchedQueueClient({
    log,
    outQueue: getUpdatesQueue(region, accountId, !!process.env.HLX_DEV_SERVER_HOST),
    swapBucket: context.attributes.bucketMap.content,
  });
  const messages = [];

  try {
    for (const { name, type, result } of results) {
      const { record, noIndex, message } = result;
      if (noIndex) {
        messages.push(BatchedQueueClient.createMessage(org, site, {
          index: name,
          deleted: true,
          record: {
            path: webPath,
          },
          timestamp: Date.now(),
          type,
        }));
      } else if (!message) {
        messages.push(BatchedQueueClient.createMessage(org, site, {
          index: name,
          record: {
            ...record,
            ...properties,
            path: webPath,
          },
          timestamp: Date.now(),
          type,
        }));
      }
    }
    await queueClient.send(messages);
  } finally {
    queueClient.close();
  }
}

/**
 * Load the complete index data from S3.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('@adobe/helix-shared-indexer').IndexConfig} index index config
 * @returns {Promise<Object>} complete index data, keyed by index name
 */
export async function loadIndexData(context, index) {
  const { contentBusId, log } = context;

  const storage = HelixStorage.fromContext(context).contentBus();
  const indexData = {};

  await processQueue([...index.indices], async ({ name, target }) => {
    const jsonTarget = jsonPath(target);
    const key = `/${contentBusId}/live${jsonTarget}`;
    const contents = await storage.get(key);
    if (!contents) {
      log.warn(`Unable to fetch paths for index ${name}, index contents not found: ${target}`);
      return;
    }
    let json;
    try {
      json = JSON.parse(contents);
    } catch (e) {
      log.warn(`Unable to fetch paths for index ${name}, index contents is not JSON.`);
      return;
    }
    const data = getDefaultSheetData(json);
    if (!Array.isArray(data)) {
      log.warn(`Unable to fetch paths for index ${name}, index contents not iterable (${data}): ${target}`);
      return;
    }
    if (contents) {
      indexData[name] = data;
    }
  });
  return indexData;
}
