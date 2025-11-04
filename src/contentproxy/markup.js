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

import fetchContent from './fetch-content.js';
import { handleFile } from './markup-file.js';
import { handleJSON } from './markup-json.js';
import { list } from './markup-list.js';
import { computeSourceUrl, getContentSourceHeaders, updateMarkupSourceInfo } from './utils.js';

/**
 * Retrieves a file from html2md.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} opts options
 * @param {string} opts.lastModified last modified
 * @param {number} opts.fetchTimeout fetch timeout
 * @returns {Promise<Response>} response
 */
async function handle(context, info, opts) {
  const { config, config: { content: { source } }, log } = context;

  const sourceUrl = await computeSourceUrl(log, info, source);
  const providerHeaders = getContentSourceHeaders(context, info, source);

  const providerParams = {
    sourceUrl,
    features: config.features?.html2md,
    limits: config.limits?.html2md,
  };
  if (config.limits?.preview?.maxImageSize) {
    if (!providerParams.limits) {
      providerParams.limits = {};
    }
    providerParams.limits.maxImageSize = config.limits.preview.maxImageSize;
  }

  const res = await fetchContent(context, info, {
    ...opts,
    usePost: true,
    provider: {
      package: 'helix3',
      name: 'html2md',
      version: context.data['hlx-html2md-version'],
      defaultVersion: 'v2',
      sourceLocationMapping: (id) => `markup:${id}`,
    },
    providerParams,
    providerHeaders,
  });

  updateMarkupSourceInfo(info.sourceInfo, res);

  return res;
}

function test(source) {
  return source?.type === 'markup';
}

/**
 * @type {import('./contentproxy.js').ContentSourceHandler}
 */
export default {
  name: 'markup',
  test,
  handle,
  handleJSON,
  handleFile,
  list,
};
