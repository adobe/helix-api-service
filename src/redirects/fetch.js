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
import { fetchS3 } from '@adobe/helix-admin-support';
import { toResourcePath } from '../support/RequestInfo.js';
import { getSheetData } from '../support/utils.js';

export const REDIRECTS_JSON_PATH = '/redirects.json';

/**
 * Retrieves the redirects map from the respective content-bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} partition partition
 * @returns {Promise<object>} redirects map or empty map if non present
 */
export default async function fetchRedirects(context, partition) {
  const { attributes, log } = context;
  const { config, content: bucket } = attributes;
  const { content: { contentBusId } } = config;

  const redirects = {};

  const key = `${contentBusId}/${partition}${REDIRECTS_JSON_PATH}`;
  const resp = await fetchS3(context, 'content', key);
  if (resp.ok) {
    const data = getSheetData(await resp.json(), ['redirects', 'default']);
    if (!data) {
      log.error(`error while loading redirects from ${bucket}/${key}: no redirect data found.`);
      return redirects;
    }
    data.forEach((mapping) => {
      const lower = Object.entries(mapping).reduce((obj, [name, value]) => {
        // eslint-disable-next-line no-param-reassign
        obj[name.toLowerCase()] = value;
        return obj;
      }, {});
      const src = (lower.source || '').trim();
      const dst = (lower.destination || '').trim();
      if (src && dst) {
        const resourcePath = toResourcePath(src);
        const dstPath = dst.startsWith('/') ? toResourcePath(dst) : '';
        // avoid redirect loop
        if (resourcePath && resourcePath !== dstPath) {
          redirects[resourcePath] = dst;
        }
      }
    });
    return redirects;
  }
  if (resp.status === 404) {
    log.info(`unable to load redirects from ${bucket}/${key}: ${resp.status}`);
    return redirects;
  }

  // really?
  throw new Error(`error while loading redirects from ${bucket}/${key}: ${resp.status}`);
}
