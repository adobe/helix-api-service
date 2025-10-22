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
import { resolveResource } from '../support/google.js';
import { StatusCodeError } from '../support/StatusCodeError.js';

function test(mp) {
  return mp && mp.type === 'google';
}

const TYPES = {
  '.md': GoogleClient.TYPE_DOCUMENT,
  '.json': GoogleClient.TYPE_SPREADSHEET,
};

/**
 * Performs a lookup from the web resource to the source document.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} param
 * @param {MountPoint} param.source mount point
 * @param {string} param.contentBusId contentBusId
 * @returns {Promise<LookupResponse>} the lookup response
 */
async function lookup(context, info, { contentBusId, source }) {
  const { ext, webPath, resourcePath } = info;
  const item = await resolveResource(context, info, { contentBusId, source, type: TYPES[ext] });
  if (!item.id) {
    throw new StatusCodeError(`no such document: ${resourcePath}`, 404);
  }
  const editFolders = item.hierarchy.map((hItem) => ({
    name: hItem.name,
    url: `https://drive.google.com/drive/u/0/folders/${hItem.id}`,
    path: hItem.path,
  }));

  return {
    status: 200,
    editUrl: item.url,
    editName: item.name,
    editContentType: item.mimeType,
    editFolders,
    webPath,
    resourcePath,
    sourceLastModified: new Date(item.lastModified).toUTCString(),
    sourceLocation: `gdrive:${item.id}`,
  };
}

export default {
  name: 'google',
  lookup,
  test,
};
