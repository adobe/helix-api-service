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
import { GoogleClient } from '@adobe/helix-google-support';

const TYPES = {
  [GoogleClient.TYPE_DOCUMENT]: {
    ext: '.md',
    item2edit: (item) => `https://docs.google.com/document/d/${item.id}/edit`,
  },
  /* c8 ignore start */
  [GoogleClient.TYPE_SPREADSHEET]: {
    ext: '.json',
    item2edit: (item) => `https://docs.google.com/spreadsheets/d/${item.id}/edit`,
  },
  file: {
    ext: '',
    item2edit: (item) => `https://drive.google.com/file/d/${item.id}/view`,
  },
  /* c8 ignore end */
};

/**
 * Resolves the resource from google drive with the specified type.
 * Note that google drive can have items with the same name in a folder, but doesn't use
 * extensions.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} param
 * @param {string} param.contentBusId contentBusId
 * @param {object} param.source mount point
 * @param {string} param.type type
 * @returns {Promise<DriveItemInfo>}
 */
export async function resolveResource(context, info, { contentBusId, source, type }) {
  const { log } = context;
  const { sourceInfo } = info;
  /* c8 ignore start */
  if (sourceInfo) {
    log.debug(`resource ${info.resourcePath} already resolved to ${sourceInfo.id}`);
    return sourceInfo;
  }
  /* c8 ignore end */

  let { relPath } = source;
  const { ext, item2edit } = TYPES[type] ?? TYPES.file;
  if (ext && relPath.endsWith(ext)) {
    relPath = relPath.substring(0, relPath.length - ext.length);
  }

  log.info(`fetch ${type} from gdrive: ${relPath}`);
  const client = await context.getGoogleClient(contentBusId);

  let hierarchy = await client.getItemsFromPath(source.id, relPath, type);
  if (!hierarchy.length && type === GoogleClient.TYPE_DOCUMENT) {
    // for documents, also try reading the markdown file
    hierarchy = await client.getItemsFromPath(source.id, `${relPath}.md`);
  }
  if (!hierarchy.length) {
    return {};
  }
  const item = hierarchy.shift();
  return {
    ...item,
    url: item2edit(item),
    hierarchy,
  };
}
