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
const FOLDER_MARKER = '_dir';
const FOLDER_CONTENT_TYPE = 'application/folder';

/**
 * Convert the directory listing from S3 format to the format expected by the client.
 *
 * @param {import('@aws-sdk/client-s3').ListObjectsV2Output} list
 *   The directory listing as returned by S3.
 * @returns {Array} The directory listing as returned to the client
 */
function transformList(list) {
  return list.map((item) => {
    if (item.key.endsWith('/')) {
      // it's a subfolder
      return {
        name: item.path,
        'content-type': FOLDER_CONTENT_TYPE,
      };
    }

    const { lastModified, path } = item;
    const sp = path.split('.');

    if (sp.length < 2) {
      // files without extensions are currently not supported
      return null;
    }
    const ext = sp.pop();
    if (ext === FOLDER_MARKER) {
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
  }).filter((i) => i)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Create a folder in the source bus, by creating a directory marker file.
 *
 * @param {import('../support/AdminContext.js').AdminContext} context context
 * @param {import('../support/RequestInfo.js').RequestInfo} info request info
 * @return {Promise<Response>} response
 */
export async function createFolder(context, info) {
  const { org, site, rawPath: key } = info;

  const folderName = key.split('/').filter((f) => f).pop();
  const path = getS3Path(org, site, `${key}${folderName}.${FOLDER_MARKER}`);

  try {
    return await putSourceFile(context, path, FOLDER_CONTENT_TYPE, '{}');
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}

/**
 * Provide a directory listing from the source bus.
 *
 * @param {import('../support/AdminContext.js').AdminContext} context context
 * @param {import('../support/RequestInfo.js').RequestInfo} info request info
 * @param {boolean} headRequest true if this is a HEAD request
 * @return {Promise<Response>} response A JSON response with the directory listing
 */
export async function listFolder(context, info, headRequest) {
  const { log } = context;

  const bucket = HelixStorage.fromContext(context).sourceBus();

  const { org, site, rawPath: key } = info;
  const path = getS3Path(org, site, key);

  try {
    const list = await bucket.list(path, { shallow: true, prefixes: true });

    // Check the length of the raw filesList. This will include the
    // directory marker files. So a directory with just a marker file
    // is reported as empty, but without anything is reported as not found.
    if (list.length === 0) {
      return new Response('', { status: 404 });
    }

    if (headRequest) {
      return new Response('', { status: 200 });
    }

    const output = transformList(list);
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
