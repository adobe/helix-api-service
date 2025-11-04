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

/* eslint-disable no-continue */

import { basename } from 'path';
import { sanitizeName, splitByExtension } from '@adobe/helix-shared-string';
import { MEDIA_TYPES } from '../media/validate.js';
import { toResourcePath } from '../support/RequestInfo.js';

/**
 * Document types that are not media.
 * @type {Array}
 */
const DOCUMENT_TYPES = [
  {
    name: 'MD',
    extensions: ['.md'],
    mime: 'text/markdown; charset=utf-8',
  },
  {
    name: 'JSON',
    extensions: ['.json'],
    mime: 'application/json',
  },
  {
    name: 'PDF',
    extensions: ['.pdf'],
    mime: 'application/pdf',
  },
];

/**
 * Allowed types for a markup content source.
 * @type {Array}
 */
export const ALLOWED_BYOM_TYPES = [
  ...DOCUMENT_TYPES,
  ...MEDIA_TYPES,
];

/**
 * Constructs a list of markup resources from the given paths.
 * The lastModified timestamp is set to the current time to force an update.
 *
 * Note: no http requests are made to the BYOM source at this point.
 * Note: if the primary content is markup and there is an overlay (markup),
 * we will asssign the location to the overlay
 *
 * @type {import('./contentproxy.js').FetchList}
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string[]} paths
 * @param {ProgressCallback} progressCB
 * @returns {Promise<ResourceInfo[]>} the list of resources
 */
export async function list(context, info, paths) {
  const { config: { content: { overlay, source } } } = context;

  // if primary content is a markup and there is an overlay, use overlay, else use mp
  let contentUrl = source.type === 'markup' && !overlay ? source.url : overlay.url;

  // if the contentUrl ends with a slash, remove it since the paths will be appended to it
  // which will start with a slash
  contentUrl = contentUrl.endsWith('/') ? contentUrl.slice(0, -1) : contentUrl;

  const map = new Map();
  for (const path of paths) {
    if (!path || path.endsWith('*')) {
      continue;
    }

    const resourcePath = toResourcePath(path);
    const existing = map.get(resourcePath);
    if (existing) {
      continue;
    }

    const fileName = basename(resourcePath);
    const [itemName, ext] = splitByExtension(fileName);
    const name = sanitizeName(itemName);

    const contentType = ALLOWED_BYOM_TYPES.find((t) => t.extensions.includes(`.${ext}`))?.mime;
    if (!contentType) {
      continue;
    }

    const location = `${contentUrl}${path}`;
    const item = {
      path,
      resourcePath,
      source: {
        name: `${name}.${ext}`,
        contentType,
        location,
        lastModified: Date.now(), // forces an update
        type: 'markup',
      },
    };
    map.set(resourcePath, item);
  }
  return Array.from(map.values());
}
