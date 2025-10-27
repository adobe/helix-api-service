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
import { getEditFolders, remapEditFolderPaths, resolveResource } from '../support/onedrive.js';

function test(contentSource) {
  return contentSource?.type === 'onedrive';
}

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
  const { log } = context;
  const {
    org, site, resourcePath, route, webPath,
  } = info;

  const drive = await context.getOneDriveClient(org, contentBusId, source.tenantId, {
    project: `${org}/${site}`,
    operation: `${route} ${resourcePath}`,
  });
  const {
    location,
    lastModified,
    contentType: editContentType,
    driveItem,
  } = await resolveResource(context, info, { source });

  let editFolders = [];
  try {
    editFolders = await getEditFolders(drive, driveItem);
    editFolders = remapEditFolderPaths(editFolders, source);
  } catch (e) {
    log.warn('error while retrieving edit folders', e);
  }

  const ret = {
    status: 200,
    webPath,
    resourcePath,
    editName: driveItem.name,
    editUrl: driveItem.webUrl,
    editContentType,
    editFolders,
    sourceLastModified: lastModified ? new Date(lastModified).toUTCString() : undefined,
    sourceLocation: location,
  };

  if (driveItem.webUrl.endsWith('.md')) {
    delete ret.editName;

    // the sharepoint url looks like: /sites/<site>/<list><filePath>
    const url = new URL(decodeURIComponent(driveItem.webUrl));
    const segs = decodeURI(url.pathname).split(/\/+/);
    const prefix = segs.slice(0, 4).join('/');
    const parentPath = segs.slice(0, segs.length - 1).join('/');

    const newUrl = new URL(`${prefix}/Forms/AllItems.aspx`, url);
    newUrl.searchParams.append('id', decodeURI(url.pathname));
    newUrl.searchParams.append('parent', parentPath);
    newUrl.searchParams.append('p', 5);
    ret.editUrl = newUrl.href;
  }
  return ret;
}

export default {
  name: 'onedrive',
  lookup,
  test,
};
