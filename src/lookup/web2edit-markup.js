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

import { computeSourceUrl } from '../contentproxy/utils.js';

/**
 * Performs a lookup from the web resource to the source document.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} source content source
 * @returns {Promise<LookupResponse>} the lookup response
 */
async function lookup(context, info, source) {
  const { log } = context;

  const { resourcePath, webPath } = info;
  if (source.url.startsWith('https://content.da.live/')) {
    const url = new URL(source.url);
    const [, org, site] = url.pathname.split('/');
    const editUrl = `https://da.live/edit#/${org}/${site}${webPath}${webPath.endsWith('/') ? 'index' : ''}`;
    const sourceLocation = await computeSourceUrl(log, info, source);
    const fetch = context.getFetch();
    const res = await fetch(sourceLocation);
    return {
      status: res.status,
      webPath,
      resourcePath,
      editUrl,
      sourceLocation: `markup:${sourceLocation}`,
    };
  }
  return {
    status: 404,
    error: `Mountpoint not supported: ${source.url}.`,
  };
}

export default {
  name: 'markup',
  lookup,
};
