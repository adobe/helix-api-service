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
import { indexPage } from './index-page.js';
import {
  getIndexTargets, getRetryParams, hasSiteConfig, shouldIndex,
  containsPath, sendToQueue,
} from './utils.js';

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
