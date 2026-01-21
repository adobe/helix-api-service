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
import processQueue from '@adobe/helix-shared-process-queue';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { sanitizePath } from '@adobe/helix-shared-string';
import { createErrorResponse } from '../contentbus/utils.js';
import { splitExtension } from '../support/RequestInfo.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { getS3Key, storeSourceFile, CONTENT_TYPES } from './utils.js';

/**
 * A folder is marked by a marker file. This allows folder to show up in bucket
 * listings without having to do a deep S3 listing.
 */
const FOLDER_MARKER = '.props';
const FOLDER_CONTENT_TYPE = 'application/folder';

/**
 * Convert the directory listing from S3 format to the format expected by the client.
 *
 * @param {import('@aws-sdk/client-s3').ListObjectsV2Output} list
 *   The directory listing as returned by S3.
 * @returns {Array} The directory listing as returned to the client the format
 * is as follows:
 * [
 *   {
 *     name: 'foldername',
 *     'content-type': 'application/folder',
 *   },
 *   {
 *     name: 'filename.ext',
 *     size: 123,
 *     'content-type': 'application/json',
 *     'last-modified': '2021-01-01T00:00:00.000Z',
 *   },
 * ]
 * Folders are returned by name only, files have their size, content type and
 * last modified date reported. The returned array is sorted by name.
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

    if (path === FOLDER_MARKER) {
      // folder marker files are ignored here
      return null;
    }

    const { ext } = splitExtension(path);
    if (!CONTENT_TYPES[ext]) {
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
  }).filter((i) => !!i)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Validate a folder path by checking that its name remains the same once
 * sanitized.
 *
 * @param {string} path The folder path, note that it must end with a slash
 */
function validateFolderPath(path) {
  // Remove the trailing slash
  const folder = path.slice(0, -1);

  if (!path.endsWith('/') || folder !== sanitizePath(folder)) {
    throw new StatusCodeError('Invalid folder path', 400);
  }
}

/**
 * Create a folder in the source bus, by creating a directory marker file.
 * The folder name must end with a slash and has to be of sanitized form.
 *
 * @param {import('../support/AdminContext.js').AdminContext} context context
 * @param {import('../support/RequestInfo.js').RequestInfo} info request info
 * @return {Promise<Response>} response
 */
export async function createFolder(context, info) {
  const { org, site, rawPath: path } = info;

  try {
    validateFolderPath(path);
    const key = getS3Key(org, site, `${path}${FOLDER_MARKER}`);

    return await storeSourceFile(context, key, 'application/json', '{}');
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}

/**
 * Delete a folder from the source bus recusively.
 *
 * @param {import('../support/AdminContext.js').AdminContext} context context
 * @param {import('../support/RequestInfo.js').RequestInfo} info request info
 * @returns {Promise<Response>} response with status 204 if successful, 404 if
 * the folder does not exist, or an error response if the folder cannot be deleted.
 */
export async function deleteFolder(context, info) {
  const { log } = context;

  const bucket = HelixStorage.fromContext(context).sourceBus();
  const { org, site, rawPath: path } = info;

  try {
    validateFolderPath(path);
    const key = getS3Key(org, site, path);

    const list = await bucket.list(key, { shallow: false });
    if (list.length === 0) {
      return new Response('', { status: 404 });
    }

    await processQueue(list, async (item) => bucket.remove(item.key));
    return new Response('', { status: 204 });
  } catch (e) {
    const opts = { e, log };
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
  const { org, site, rawPath: path } = info;

  try {
    validateFolderPath(path);
    const key = getS3Key(org, site, path);
    const list = await bucket.list(key, { shallow: true, includePrefixes: true });

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
