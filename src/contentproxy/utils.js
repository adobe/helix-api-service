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
import { isAdobeMountpoint } from '../support/adobe-source.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { isInternal } from '../support/utils.js';

/**
 * Maximum file size limit to download.
 */
export const FILE_SIZE_LIMIT = 500 * 1024 * 1024; // 500MB

const AZURE_BLOB_REGEXP = /^https:\/\/hlx\.blob\.core\.windows\.net\/external\//;

const MEDIA_BLOB_REGEXP = /^https:\/\/.*\.hlx3?\.(live|page)\/media_.*/;

const HELIX_URL_REGEXP = /^https:\/\/(?!admin\.|www\.)[^.]+\.hlx3?\.(live|page)\/?.*/;

/**
 * Rewrites the media, helix or external url. Returns the original if not rewritten.
 * @param {string} url
 * @returns {string|null}
 */
export function rewriteCellUrl(url) {
  if (!url || !url.startsWith('https://')) {
    return url;
  }
  const { pathname, search, hash } = new URL(url);

  if (AZURE_BLOB_REGEXP.test(url)) {
    const filename = pathname.split('/').pop();
    const [name, props] = hash.split('?');
    const extension = name.split('.').pop() || 'jpg';
    const newHash = props ? `#${props}` : '';
    return `./media_${filename}.${extension}${newHash}`;
  }
  if (MEDIA_BLOB_REGEXP.test(url)) {
    return `.${pathname}${hash}`;
  }
  if (HELIX_URL_REGEXP.test(url)) {
    return `${pathname}${search}${hash}`;
  }
  return url;
}

function assertValidSingleSheetJSON(obj) {
  if (!Array.isArray(obj.data)) {
    throw Error('invalid sheet; expecting data array');
  }

  ['limit', 'total', 'offset'].forEach((prop) => {
    if (typeof obj[prop] !== 'number') {
      throw Error(`invalid sheet; expecting ${prop} of type number`);
    }
  });

  // remove extra hidden properties
  for (const name of Object.keys(obj)) {
    if (name.startsWith(':') && name !== ':type' && name !== ':version') {
      // eslint-disable-next-line no-param-reassign
      delete obj[name];
    }
  }
}

function assertValidMultiSheetJSON(obj) {
  const {
    // eslint-disable-next-line no-unused-vars
    ':type': _type,
    ':names': names,
    ':version': version,
    ...rest
  } = obj;
  if (!Array.isArray(names)) {
    throw Error('invalid multisheet; expecting names array');
  }
  if (typeof version !== 'number') {
    throw Error('invalid multisheet; expecting version of type number');
  }
  const sheetNames = Object.fromEntries(names.map((name) => ([name, true])));
  Object.entries(rest).forEach(([name, sheet]) => {
    if (name.startsWith(':')) {
      // remove properties starting with ':'
      // eslint-disable-next-line no-param-reassign
      delete obj[name];
    } else if (!sheetNames[name]) {
      throw Error(`invalid multisheet; sheet '${name}' not in names array`);
    } else {
      delete sheetNames[name];
      assertValidSingleSheetJSON(sheet);
    }
  });

  const missing = Object.keys(sheetNames);
  if (missing.length > 0) {
    throw Error(`invalid multisheet; missing sheets from names array: ${missing}`);
  }
}

export function assertValidSheetJSON(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw Error('invalid sheet; expecting object');
  }

  const sheetType = obj[':type'];
  if (sheetType === 'multi-sheet') {
    return assertValidMultiSheetJSON(obj);
  } else if (sheetType === 'sheet') {
    return assertValidSingleSheetJSON(obj);
  }

  throw Error('invalid sheet; unknown type');
}

/**
 * Returns the headers to be passed to the content-source for markup, markup-file and markup-json.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} source content source
 * @returns {object} provider headers
 */
export function getContentSourceHeaders(context, info, source) {
  const { attributes: { authInfo } } = context;
  const { headers, rawPath } = info;
  const providerHeaders = {};

  let sourceAuthorization = headers['x-content-source-authorization'];
  if (!sourceAuthorization && isAdobeMountpoint(source) && authInfo.imsToken) {
    // don't share IMS token with 3rd party content sources
    sourceAuthorization = `Bearer ${authInfo.imsToken}`;
  }
  if (sourceAuthorization) {
    providerHeaders.authorization = sourceAuthorization;
  }
  providerHeaders['x-content-source-location'] = headers['x-content-source-location'] || rawPath;
  return providerHeaders;
}

/**
 * Computes the source url for the markup handler. This is the URL that will be used to fetch the
 * resource directly from the source location or via html2md.
 * @param {object} log logger
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} contentSource content source
 * @returns {Promise<URL>}
 */
export async function computeSourceUrl(log, info, contentSource) {
  let { suffix } = contentSource;

  let url;
  try {
    url = new URL(contentSource.url);
  } catch (e) {
    throw new StatusCodeError('Bad mountpoint URL in fstab', 400);
  }
  if (await isInternal(url.hostname, log)) {
    throw new StatusCodeError(`markup host is internal or unknown: ${url.hostname}`, 400);
  }
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

/**
 * From a JSON response, retrieves the `data` sheet if this is a single sheet,
 * or the `default` data sheet if it is a multisheet.
 * Returns `null` if there is neither.
 *
 * @param {any} json JSON object
 * @param {String[]} names names to check in a multi sheet
 */
export function getDefaultSheetData(json) {
  return getSheetData(json, ['default']);
}

/**
 * Updates the sourceInfo based on the response from byom content source.
 * We set the size based on the Content-Length header in the response.
 * If the response is not ok, we remove size and lastModified which were
 * initially set in markup-list.
 *
 * @param {import('./contentproxy.js').SourceInfo} sourceInfo the source info
 * @param {Response} response the response
 */
export function updateMarkupSourceInfo(sourceInfo, response) {
  if (sourceInfo) {
    const contentLength = response.headers.get('content-length');
    // eslint-disable-next-line no-param-reassign
    sourceInfo.size = Number.parseInt(contentLength, 10) || undefined;

    if (!response.ok) {
      // eslint-disable-next-line no-param-reassign
      delete sourceInfo.lastModified;
    }
  }
}

/**
 * Adds a last-modified header to an existing set of headers, if the value
 * given represents a valid date.
 */
export function addLastModified(headers, value) {
  if (value) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      // eslint-disable-next-line no-param-reassign
      headers['last-modified'] = new Date(timestamp).toUTCString();
    }
  }
  return headers;
}

/**
 * Parses a JSON string and validates it as a sheet JSON.
 * Throws an error if parsing fails or the JSON is invalid.
 *
 * @param {string} data - The JSON string to parse.
 * @returns {object} The validated sheet JSON object.
 */
export function parseSheetJSON(data) {
  let json;
  try {
    json = JSON.parse(data);
  } catch {
    throw Error('invalid sheet json; failed to parse');
  }

  assertValidSheetJSON(json);
  return json;
}
