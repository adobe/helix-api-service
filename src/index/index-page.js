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
import { Response } from '@adobe/fetch';
import { contains, indexResource } from '@adobe/helix-shared-indexer';
import { cleanupHeaderValue } from '@adobe/helix-shared-utils';
import { fetchPage } from './fetch-page.js';
import {
  getIndexType, getFetchHeaders, isSiteConfig,
  INTERNAL_SITEMAP_INDEX,
} from './utils.js';

/**
 * Index a single page for a single index.
 *
 * @param {string} path page path
 * @param {import('@adobe/helix-shared-indexer').Index} config a single index configuration
 * @param {object} page headers and body, if HTML
 * @param {object} log logger
 * @returns object with either message, noIndex or record
 */
function indexPageInIndex(path, config, page, log) {
  if (!contains(config, path)) {
    return {
      message: 'requested path does not match index configuration',
    };
  }
  if (page.gone) {
    return {
      noIndex: true,
      message: 'requested path returned a 301 or 404',
    };
  }
  if (!isSiteConfig(config) && !page.body) {
    return {
      message: 'non-HTML pages can only be added to site configurations',
    };
  }

  const internal = config.name === INTERNAL_SITEMAP_INDEX;
  let configToPass = config;
  let checkRobots = false;

  if (internal && page.body && !config.properties.find(({ name }) => name === 'robots')) {
    configToPass = {
      properties: [
        ...config.properties,
        {
          name: 'robots',
          select: 'head > meta[name="robots"]',
          value: 'attribute(el, "content")',
        },
      ],
    };
    checkRobots = true;
  }

  const record = indexResource(path, page, configToPass, log);
  if (checkRobots) {
    if (record.robots.toLowerCase().includes('noindex')) {
      log.info(`[index] indexed resource specified 'noindex' in robots: not added to ${config.name}`);
      return {
        noIndex: true,
        message: 'requested path has \'noindex\' property set',
      };
    }
    if (internal) {
      delete record.robots;
    }
  }
  return { record };
}

/**
 * Compute the index records for a resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('@adobe/helix-shared-indexer').IndexConfig} index index config
 * @param {import('fetch-retry').RequestInitRetryParams} [retryParams] retry params
 * @returns {Promise<Response>} response
 */
export async function indexPage(context, info, index, retryParams) {
  const { config: { content: { source } }, log } = context;
  const { webPath, resourcePath } = info;

  const url = info.getLiveUrl();
  const headers = await getFetchHeaders(context, info);

  const page = await fetchPage(context, url, headers, retryParams);
  if (page.error) {
    return new Response('', {
      status: page.status,
      headers: {
        'x-error': cleanupHeaderValue(page.error),
      },
    });
  }
  const results = index.indices.map((config) => {
    const result = indexPageInIndex(webPath, config, page, log);
    return {
      name: config.name,
      type: getIndexType(config, source.type),
      result,
    };
  });
  return new Response(JSON.stringify({ webPath, resourcePath, results }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
