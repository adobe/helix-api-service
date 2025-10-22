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

import { StatusCodeError } from '../support/StatusCodeError.js';

/**
 * Computes the source url for the markup handler. This is the URL that will be used to fetch the
 * resource directly from the source location or via html2md.
 * @param {object} log logger
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} mp mount point
 * @returns {Promise<URL>}
 */
export async function computeSourceUrl(log, info, mp) {
  let { suffix } = mp;

  let url;
  try {
    url = new URL(mp.url);
  } catch (e) {
    throw new StatusCodeError('Bad mountpoint URL in fstab', 400);
  }
  /* TODO
  if (await isInternal(url.hostname, log)) {
    throw new StatusCodeError(`markup host is internal or unknown: ${url.hostname}`, 400);
  }
  */
  const { ext } = info;
  let { resourcePath } = info;
  if (ext === '.md' && suffix) {
    const idx = suffix.indexOf('?');
    if (idx >= 0) {
      const sp = new URLSearchParams(suffix.substring(idx + 1));
      sp.forEach((value, key) => {
        url.searchParams.set(key, value);
      });
      suffix = suffix.substring(0, idx);
    }
    resourcePath = resourcePath.substring(0, resourcePath.length - 3) + suffix;
  }
  if (resourcePath.endsWith('/index.md')) {
    resourcePath = resourcePath.substring(0, resourcePath.length - 8);
  } else if (resourcePath.endsWith('.md')) {
    resourcePath = resourcePath.substring(0, resourcePath.length - 3);
  }
  url.pathname = (url.pathname + resourcePath).replaceAll(/\/+/g, '/');
  return url;
}

/**
 * From a JSON response, retrieves the `data` sheet if this is a single sheet,
 * or it returns the first existing sheet given by a list of names, if it is a
 * multisheet.
 * Returns `null` if there is neither.
 *
 * @param {any} json JSON object
 * @param {String[]} names names to check in a multi sheet
 */
export function getSheetData(json, names) {
  if (Array.isArray(json.data)) {
    return json.data;
  }
  let sheet;

  const match = names.find((name) => !!json[name]);
  if (match) {
    sheet = json[match];
  }
  if (Array.isArray(sheet?.data)) {
    return sheet.data;
  }
  return null;
}
