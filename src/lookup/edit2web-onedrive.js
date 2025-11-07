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
import { getEditFolders, getSourceLocationAndDate, remapEditFolderPaths } from '../support/onedrive.js';

/**
 * Does a reverse lookup for a onedrive/sharepoint document.
 *
 * Possible document urls format (as seen in the browser):
 *
 * Documents:
 * - https://{tenant}/:w:/r/{site}/{subsite}/_layouts/15/Doc.aspx?sourcedoc=%7B{listItemId}%7D&file={filename.docx}&action=default&mobileredirect=true
 *
 * Spreadsheets:
 * - https://{tenant}/:x:/r/{site}/{subsite}/_layouts/15/Doc.aspx?sourcedoc=%7B{listItemId}%7D&file={filename.xlsx}&action=default&mobileredirect=true
 *
 * Markdown files:
 * - https://{tenant}/{site}/{subsite}/{drive}/Forms/AllItems.aspx?id={filePath}&parent={parentPath}
 *
 * Markdown files (on different tenants):
 * - https://{tenant}/{site}/{subsite}/{drive}/Forms/AllItems.aspx?listurl={listurl}&id={filePath}&parent={parentPath}
 *
 * Documents on share links:
 * - https://{tennat}/:w:/r/{site}/{subsite}/_layouts/15/guestaccess.aspx?e=4%3AxSM7pa&at=9&wdLOR=c64EF58AE-CEBB-0540-B444-044062648A17&share=ERMQVuCr7S5FqIBgvCJezO0BUUxpzherbeKSSPYCinf84w
 *
 * Documents on share links with or w/o email:
 * - https://{tenant}/:w:/s/{site}/EfaZv8TXBKtNkDb8MH0HoOsBnwRunv3BxXZ_-XgcEwiqew?email={email}&e=RLSD8R
 * - https://{tenant}/:w:/s/{site}/EfaZv8TXBKtNkDb8MH0HoOsBnwRunv3BxXZ_-XgcEwiqew?e=YxP8QV
 *
 * Documents on custom domains (tenant in 1st mountpoint)
 * - https://sp-cloud.example.com/:w:/s/{site}/EfaZv8TXBKtNkDb8MH0HoOsBnwRunv3BxXZ_-XgcEwiqew?e=YxP8QV
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} opts options
 * @param {string} opts.editUrl edit URL
 * @param {string} opts.contentBusId content bus id
 * @param {object} opts.source contentSource
 * @returns {Promise<LookupResponse>} lookup response
 */
async function lookup(context, info, opts) {
  const { log } = context;
  const { editUrl, contentBusId, source } = opts;
  let uri = new URL(editUrl);

  const drive = await context.getOneDriveClient(info.org, info.site, {
    contentBusId,
  });
  drive.auth.tenant = source.tenantId;

  // if uri is sharelink, resolve it first
  if (uri.searchParams.get('share') || uri.pathname.indexOf('/s/') >= 0) {
    await drive.auth.initTenantFromUrl(uri.href);
    const driveItem = await drive.getDriveItemFromShareLink(uri.href);
    const { webUrl } = driveItem;
    uri = new URL(webUrl);
  }

  const sourceDoc = uri.searchParams.get('sourcedoc');
  const rootFolder = uri.searchParams.get('RootFolder');
  const id = uri.searchParams.get('id');

  let docPath;
  let docHost = uri.hostname;
  let sourceLastModified;
  let sourceLocation;
  let driveItem;
  if (sourceDoc) {
    // for documents and sheets, the uri only contains a sharepoint id. so we need to get the
    // path via the webUrl of the list item. find site and possible subsite from
    const segs = uri.pathname.split('/').filter((s) => s && s !== 'r' && s[0] !== ':');
    const idx = segs.indexOf('_layouts');
    if (idx < 0) {
      throw Error(`unable to resolve sharepoint item. unknown path: ${uri.pathname}`);
    }
    segs.length = idx;
    const itemId = sourceDoc.replace(/[{}]/g, '');
    const listUri = `/sites/${uri.hostname}:/${segs.join('/')}:/items/${itemId}`;
    log.info(`retrieving sharepoint item with ${listUri}`);

    await drive.auth.initTenantFromUrl(uri.href);
    const sharePointItem = await drive.doFetch(listUri);
    [sourceLocation, sourceLastModified] = getSourceLocationAndDate(
      sharePointItem,
      sourceLocation,
      sourceLastModified,
    );
    const { webUrl } = sharePointItem;
    driveItem = await drive.getDriveItemFromShareLink(webUrl);
    const docUrl = new URL(webUrl);
    docPath = docUrl.pathname;
    docHost = docUrl.hostname;
    log.info('path/host from weburl', docPath, docHost);
  } else if (id) {
    sourceLocation = `onedrive:${id}`;
    docPath = encodeURI(id);
    log.info('path/host from id:', id, docHost);
    await drive.auth.initTenantFromUrl(uri.href);
    driveItem = await drive.getDriveItemFromShareLink(editUrl);
  } else if (rootFolder) {
    log.info('path/host from rootFolder:', rootFolder, docHost);
    const folderUrl = `https://${docHost}${rootFolder}`;
    await drive.auth.initTenantFromUrl(uri.href);
    driveItem = await drive.getDriveItemFromShareLink(folderUrl);
    docPath = new URL(driveItem.webUrl).pathname;
  } else {
    await drive.auth.initTenantFromUrl(uri.href);
    driveItem = await drive.getDriveItemFromShareLink(editUrl);
    docPath = new URL(driveItem.webUrl).pathname;
  }

  // make documentPath relative to mountpoint
  const { webUrl } = await drive.getDriveItemFromShareLink(source.url);
  const rootUrl = new URL(webUrl);
  if (rootUrl.hostname !== docHost) {
    throw Error(`could not resolve document https://${docHost}${docPath} with mountpoint: ${source.url}`);
  }
  const rootDir = `${rootUrl.pathname}/`;

  // update item info
  let editFolders = [];
  try {
    editFolders = await getEditFolders(drive, driveItem);
    editFolders = remapEditFolderPaths(editFolders, source);
  } catch (e) {
    log.warn('error while retrieving edit folders', e);
  }
  const editContentType = driveItem.folder
    ? 'application/folder'
    : driveItem.file?.mimeType;
  [sourceLocation, sourceLastModified] = getSourceLocationAndDate(
    driveItem,
    sourceLocation,
    sourceLastModified,
  );

  const editName = decodeURIComponent(docPath.substring(docPath.lastIndexOf('/') + 1));
  let relPath = docPath.substring(rootDir.length);
  // replace extension
  let ext = '';
  if (!driveItem.folder) {
    const idx = relPath.lastIndexOf('.');
    if (idx > 0) {
      ext = relPath.substring(idx);
      relPath = relPath.substring(0, idx);
    }
    ext = {
      '.xlsx': '.json',
      '.docx': '.md',
      '': '.md',
    }[ext] ?? ext;
  }
  return {
    status: 200,
    resourcePath: decodeURIComponent(`/${relPath}${ext}`),
    editUrl,
    editName,
    editContentType,
    editFolders,
    sourceLastModified,
    sourceLocation,
  };
}

export default {
  name: 'onedrive',
  lookup,
};
