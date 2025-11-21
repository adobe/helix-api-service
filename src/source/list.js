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
import { getPath } from './utils.js';

// A directory is marked by a .dir file
// This is to allow directories to show up in file listings without
// having to do a deep S3 listing.
const DIR_MARKER = 'dir';

/**
 * Convert the directory listing from S3 format to the format expected by the client.
 *
 * @param {import('@aws-sdk/client-s3').ListObjectsV2Output} list
 *   The directory listing as returned by S3
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
  }).filter((i) => i);
}

/**
 * Provide a directory listing from the source bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {boolean} headRequest true if this is a HEAD request
 * @return {Promise<Response>} response A JSON response with the directory listing
 */
export async function accessDirListing(context, info, headRequest) {
  const { log } = context;

  const storage = HelixStorage.fromContext(context);
  const bucket = storage.sourceBus();

  const { org, site, rawPath: key } = info;
  const path = getPath(org, site, key);

  try {
    const list = await bucket.list(path, { shallow: true });
    if (list.length === 0 && key.length > 1) {
      const dirMarker = `${getPath(org, site, key.slice(0, -1))}.${DIR_MARKER}`;
      const emptyDir = await bucket.head(dirMarker);
      if (emptyDir?.$metadata?.httpStatusCode === 200) {
        return new Response(headRequest ? '' : '[]', { status: 200 });
      }
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
