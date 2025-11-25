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
import { getS3Path } from './utils.js';

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
function transformOutput(list) {
  return list.map((item) => {
    const { lastModified, path } = item;

    const sp = path.split('.');
    if (sp.length <= 1) {
      // Files without extensions are currently not supported
      return null;
    }

    const ext = sp.pop();
    if (ext === DIR_MARKER) {
      const dirName = sp[0];
      return {
        name: `${dirName}/`,
        'content-type': 'application/folder',
      };
    }

    const timestamp = new Date(lastModified);
    return {
      name: path,
      size: item.contentLength,
      'content-type': item.contentType,
      'last-modified': timestamp.toISOString(),
    };
  }).filter((i) => i)
    .sort((a, b) => a.name.localeCompare(b.name));
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
  const path = getS3Path(org, site, `${key.slice(0, -1)}.${DIR_MARKER}`);
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
    // Ask S3 for a folder listing
    const list = await bucket.list(path, { shallow: true });
    if (list.length === 0 && key.length > 1) {
      // The folder could be an empty folder, in which case S3 doesn't report it.
      // Let's check if there is a file in the parent folder with the ._dir extension.
      const dirMarker = `${getS3Path(org, site, key.slice(0, -1))}.${DIR_MARKER}`;
      const emptyDir = await bucket.head(dirMarker);

      if (emptyDir?.$metadata?.httpStatusCode === 200) {
        // If the marker file exists, the folder exists, but it empty.
        return new Response(headRequest ? '' : '[]', { status: 200 });
      }
      // Folder does not exist.
      return new Response('', { status: 404 });
    }

    if (headRequest) {
      return new Response('', { status: 200 });
    }

    const output = transformOutput(list);
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
