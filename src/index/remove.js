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
import { contains } from '@adobe/helix-shared-indexer';
import { getIndexType, loadIndexData, sendToQueue } from './utils.js';

/**
 * Delete the index records for a resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('@adobe/helix-shared-indexer').IndexConfig} index index config
 * @returns {Promise<Response>} response
 */
export default async function remove(context, info, index) {
  const { config: { content: { source } } } = context;
  const { resourcePath, webPath } = info;

  const indexData = await loadIndexData(context, index);
  const results = index.indices.map((config) => {
    const data = indexData[config.name] ?? [];
    if (!contains(config, webPath) && data.findIndex((row) => row.path === webPath) === -1) {
      return {
        name: config.name,
        type: getIndexType(config, source.type),
        result: {
          path: webPath,
          message: 'requested path does not match index configuration',
        },
      };
    }
    return {
      name: config.name,
      type: getIndexType(config, source.type),
      result: {
        path: webPath,
        noIndex: true,
      },
    };
  });
  await sendToQueue(context, info, results);
  return new Response(JSON.stringify({ webPath, resourcePath, results }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
