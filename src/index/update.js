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
import { getContentBusInfo } from '../contentbus/contentbus.js';
import { indexPage } from './index-page.js';
import {
  getIndexTargets, hasSiteConfig, shouldIndex,
  containsPath, sendToQueue,
} from './utils.js';

/**
 * Used for our retry count below.
 */
const MOCHA_ENV = (process.env.HELIX_FETCH_FORCE_HTTP1 === 'true');

/**
 * Given a date as string, returns an object consisting of the string in s
 * and the number in n, or Number.NaN if it can't be parsed.
 */
function parseDate(value) {
  return { s: value, n: value ? Date.parse(value) : Number.NaN };
}

/**
 * Returns the retry params to pass to `fetchPage`.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 *
 * @returns {Promise<import('fetch-retry').RequestInitRetryParams>} params
 */
async function getRetryParams(context, info) {
  const { log } = context;
  /* c8 ignore next */
  const retryDelay = context.attributes.retryDelay ?? 1000;

  // get last modified of the related S3 object for comparison
  const contentInfo = await getContentBusInfo(context, info, 'live');
  const sourceLastModified = parseDate(contentInfo.sourceLastModified);
  return {
    retries: MOCHA_ENV ? 1 /* c8 ignore next */ : 2,
    retryDelay: (attempt) => 2 ** attempt * retryDelay,
    retryOn: (attempt, error, response) => {
      if (error) {
        return false;
      }
      const { status } = response;
      if (status === 404 && !Number.isNaN(sourceLastModified.n)) {
        log.warn(`404 HTTP response from url but source exists: (${sourceLastModified.s}), will retry`);
        return true;
      }
      if (status === 200) {
        // response is ok, now check whether it's fresh enough
        const httpLastModified = parseDate(response.headers.get('Last-Modified'));

        // we use the fact that a < b is false when either a or b or both are NaN
        if (httpLastModified.n < sourceLastModified.n) {
          log.warn(`HTTP response from url is older (${httpLastModified.s}) than source: (${sourceLastModified.s})`);
          return true;
        }
      }
      return false;
    },
  };
}

/**
 * Update the index records for a resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('@adobe/helix-shared-indexer').IndexConfig} index index config
 * @param {object} properties extra properties to add to the record
 * @returns {Promise<Response>} response
 */
export default async function update(context, info, index, properties = {}) {
  const { webPath, resourcePath, ext } = info;
  if (webPath.startsWith('/.helix/') || !containsPath(index, webPath)) {
    return new Response('', { status: 204 });
  }

  const excludes = getIndexTargets(index);
  const includeOther = hasSiteConfig(index);

  if (!shouldIndex(includeOther, ext) || excludes.includes(resourcePath)) {
    return new Response('', { status: 204 });
  }

  const retryParams = await getRetryParams(context, info);
  const response = await indexPage(context, info, index, retryParams);
  if (response.status !== 200) {
    return response;
  }
  const json = await response.json();
  await sendToQueue(context, info, json.results, properties);
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
