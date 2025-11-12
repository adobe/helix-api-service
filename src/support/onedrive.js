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
/* eslint-disable no-param-reassign */
import { OneDrive, OneDriveAuth } from '@adobe/helix-onedrive-support';
import { getCachePlugin } from '@adobe/helix-shared-tokencache';
import { StatusCodeError } from './StatusCodeError.js';

const APP_USER_AGENT = 'NONISV|Adobe|AEMContentSync/1.0';

/**
 * Returns the edit folders for the given drive item.
 * @param {OneDrive} drive the onedrive client
 * @param {DriveItem} driveItem the onedrive item
 * @returns {Promise<EditFolderInfo[]>} the folders information
 */
export async function getEditFolders(drive, driveItem) {
  const editFolderUrls = [];
  const folderItem = await drive.getDriveItem({
    id: driveItem.parentReference.id,
    parentReference: {
      driveId: driveItem.parentReference.driveId,
    },
  });
  const parentUrl = new URL(decodeURIComponent(folderItem.webUrl));
  const parentSegs = decodeURI(parentUrl.pathname).split(/\/+/);
  for (let i = parentSegs.length; i > 2; i -= 1) {
    parentUrl.pathname = parentSegs.slice(0, i).join('/');
    editFolderUrls.push({
      name: parentSegs[i - 1],
      url: parentUrl.href,
      path: parentUrl.pathname,
    });
  }
  return editFolderUrls;
}

/**
 * Maps the edit folder paths according to the mountpoint root
 * @param folders
 * @param contentSource
 */
export function remapEditFolderPaths(folders, contentSource) {
  const rootUrl = new URL(contentSource.url);
  const rootDir = `${rootUrl.pathname}/`;

  folders.forEach((fld) => {
    // reject path not starting with root dir
    if (!fld.path.startsWith(rootDir) && fld.path !== rootUrl.pathname) {
      // eslint-disable-next-line no-param-reassign
      fld.path = '';
      return;
    }
    const relPath = fld.path.substring(rootDir.length);
    // eslint-disable-next-line no-param-reassign
    fld.path = `/${relPath}`;
  });

  return folders.filter((fld) => !!fld.path);
}

/**
 * Note that word2md does not respond a last-modified date, if the drive item is requested
 * directly, because the https://docs.microsoft.com/en-us/graph/api/driveitem-get-content
 * does not return a last-modified and an extra request to get the drive item metadata is avoided.
 *
 * One caveat here is that the computed last modified for the document must accommodate for
 * potential word2md serialization changes. This is currently hardcoded in
 * `LAST_WORD2MD_FORMAT_DATE`, but could be provided from word2md, maybe in a
 * `x-word2md-format-date` header.
 *
 * However, the source last-modified date should also be reflected correct in the status
 * responses, so this is kept as a hardcoded value.
 */
const LAST_WORD2MD_FORMAT_DATE = Date.parse('2021-06-09');

/**
 * Returns the last modified time from the item, taking in account the potential format modification
 * of word2md.
 *
 * @param {DriveItem} item the item
 * @return {number|null} source last modified as a number or null
 */
export function getSourceLastModified(item) {
  let dateTime = Date.parse(item.lastModifiedDateTime);
  if (!Number.isNaN(dateTime)) {
    if (item.file?.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      dateTime = Math.max(dateTime, LAST_WORD2MD_FORMAT_DATE);
    }
    return dateTime;
  }
  return null;
}

/**
 * Returns the source location and last modified date for an onedrive item
 * @param {DriveItem} item the item
 * @param {string} location default value for location
 * @param {string} lastModified default value for lastModified
 * @returns {string[]}
 */
/* c8 ignore start */
export function getSourceLocationAndDate(item, location, lastModified) {
  const dateTime = getSourceLastModified(item);
  if (dateTime !== null) {
    lastModified = new Date(dateTime).toUTCString();
  }

  if (item.id) {
    location = OneDrive.driveItemToURL(item).href;
  }
  return [location, lastModified];
}
/* c8 ignore end */

/**
 * Performs a lookup from the web resource to the source document (e.g. word document).
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} param object
 * @param {object} param.source content source
 * @returns {Promise<object>} resource info
 */
export async function resolveResource(context, info, { source }) {
  const { contentBusId, log } = context;
  const { org, site, sourceInfo } = info;

  /* c8 ignore start */
  if (sourceInfo) {
    log.debug(`resource ${info.resourcePath} already resolved to ${sourceInfo.location}`);
    return sourceInfo;
  }
  /* c8 ignore end */

  let itemPath = info.resourcePath;
  if (info.ext === '.md') {
    itemPath = `${itemPath.substring(0, itemPath.length - 3)}.docx`;
  } else if (info.ext === '.json') {
    itemPath = `${itemPath.substring(0, itemPath.length - 5)}.xlsx`;
  }

  const drive = await context.getOneDriveClient(org, site, {
    contentBusId,
    tenant: source.tenantId,
    logFields: {
      project: `${org}/${site}`,
      operation: `${info.route} ${info.resourcePath}`,
    },
  });
  log.debug(`resolving sharelink to ${source.url}`);
  const rootItem = await drive.getDriveItemFromShareLink(source.url);
  log.info(`fetch from onedrive: ${itemPath}`);
  const [driveItem] = await drive.fuzzyGetDriveItem(rootItem, itemPath, true);
  if (!driveItem) {
    throw new StatusCodeError(`no such document: ${itemPath}`, 404);
  }

  const lastModified = getSourceLastModified(driveItem);
  const location = OneDrive.driveItemToURL(driveItem).href;

  return {
    name: driveItem.name,
    location,
    contentType: driveItem.file?.mimeType || 'application/octet-stream',
    lastModified,
    size: driveItem.size || 0,
    driveItem, // we include the driveItem here, but it is only used by lookup.
  };
}

/**
 * Get or create a OneDrive client.
 *
 * @param {string} org org
 * @param {string} site site
 * @param {string} contentBusId content bus id
 * @param {string} tenant tenant id
 * @param {object} logFields log fields
 * @returns {Promise<OneDrive>} onedrive client
 */
export async function getOneDriveClient({
  bucketMap, org, contentBusId, tenant, logFields, env, log,
}) {
  const { code: codeBucket, content: contentBucket } = bucketMap;
  const cachePlugin = await getCachePlugin({
    owner: org,
    contentBusId,
    log,
    codeBucket,
    contentBucket,
  }, 'onedrive');

  const auth = new OneDriveAuth({
    log,
    clientId: env.AZURE_HELIX_SERVICE_CLIENT_ID,
    clientSecret: env.AZURE_HELIX_SERVICE_CLIENT_SECRET,
    cachePlugin,
    tenant,
    acquireMethod: env.AZURE_HELIX_SERVICE_ACQUIRE_METHOD,
    logFields,
  });

  return new OneDrive({
    userAgent: APP_USER_AGENT,
    auth,
    log,
  });
}
