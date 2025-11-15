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
  getIndexTargets, hasSiteConfig, shouldIndex, containsPath,
} from './utils.js';

/**
 * Returns the index records for a resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('@adobe/helix-shared-indexer').IndexConfig} index index config
 * @returns {Promise<Response>} response
 */
export default async function status(context, info, index) {
  const { webPath, resourcePath, ext } = info;
  if (webPath.startsWith('/.helix/') || !containsPath(index, webPath)) {
    return new Response('', { status: 204 });
  }

  const excludes = getIndexTargets(index);
  const includeOther = hasSiteConfig(index);

  if (!shouldIndex(includeOther, ext) || excludes.includes(resourcePath)) {
    return new Response('', { status: 204 });
  }

  const response = await indexPage(context, info, index);
  return response;
}
