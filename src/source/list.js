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
import { Response } from '@adobe/fetch';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { createErrorResponse } from '../contentbus/utils.js';
import { putSourceFile } from './put.js';
import { getS3Path, CONTENT_TYPES } from './utils.js';

// A directory is marked by a marker file.
// This is to allow directories to show up in file listings without
// having to do a deep S3 listing.
const DIR_MARKER = '_dir';

/**
 * Convert the directory listing from S3 format to the format expected by the client.
 *
 * @param {import('@aws-sdk/client-s3').ListObjectsV2Output} list
 *   The directory listing as returned by S3.
 * @returns {Array} The directory listing as returned to the client
 */
function transformFiles(list) {
  return list.map((item) => {
    const { lastModified, path } = item;
    const sp = path.split('.');

    if (sp.length < 2) {
      // files without extensions are currently not supported
      return null;
    }
    const ext = sp.pop();
    if (ext === DIR_MARKER) {
      // dir marker files are ignored here
      return null;
    }
    if (!CONTENT_TYPES[`.${ext}`]) {
      // unknown content type
      return null;
    }

    const timestamp = new Date(lastModified);
    return {
      name: path,
      size: item.contentLength,
      'content-type': item.contentType,
      'last-modified': timestamp.toISOString(),
    };
  }).filter((i) => i);
}
/**
 * Convert the folder prefix listing from S3 format to the format expected by the client.
 *
 * @param {Array<string>} list The folder prefix listing as returned by S3.
 * @returns {Array} The folder listing as returned to the client
 */
function transformFolders(list) {
  // report only the last name segment of the folder in the name field
  return list.map((folder) => {
    const sp = folder.split('/').filter((f) => f);
    return {
      name: sp.pop().concat('/'),
      'content-type': 'application/folder',
    };
  });
}

/**
 * Create a folder in the source bus, by creating a directory marker file.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response
 */
export async function createFolder(context, info) {
  const { org, site, rawPath: key } = info;

  const folderName = key.split('/').filter((f) => f).pop();
  const path = getS3Path(org, site, `${key}${folderName}.${DIR_MARKER}`);
  return putSourceFile(context, path, `.${DIR_MARKER}`, '{}');
}

/**
 * Provide a directory listing from the source bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {boolean} headRequest true if this is a HEAD request
 * @return {Promise<Response>} response A JSON response with the directory listing
 */
export async function listFolder(context, info, headRequest) {
  const { log } = context;

  const bucket = HelixStorage.fromContext(context).sourceBus();

  const { org, site, rawPath: key } = info;
  const path = getS3Path(org, site, key);

  try {
    const folderList = await bucket.listFolders(path);
    const fileList = await bucket.list(path, { shallow: true });

    // Check the length of the raw files and folders. This will include the
    // directory marker files.
    if (fileList.length + folderList.length === 0) {
      return new Response('', { status: 404 });
    }

    if (headRequest) {
      return new Response('', { status: 200 });
    }

    const folders = transformFolders(folderList);
    const files = transformFiles(fileList);
    const output = [...folders, ...files].sort((a, b) => a.name.localeCompare(b.name));

    const headers = {
      'Content-Type': 'application/json',
    };
    return new Response(JSON.stringify(output), { status: 200, headers });
  } catch (e) {
    const opts = { e, log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
