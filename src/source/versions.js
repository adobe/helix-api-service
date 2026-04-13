/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { isValid } from 'ulid';
import { createErrorResponse } from '../contentbus/utils.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { accessSourceFile, VERSION_FOLDER } from './source-client.js';
import { getS3Key, getDocID } from './utils.js';

function handleNoVersions() {
  const headers = {
    'Content-Type': 'application/json',
  };
  return new Response('[]', { headers });
}

/**
 * List all versions of a file returned in order from old to new.
 * The response is a JSON array of objects with version information.
 * For example:
 * [
 *   {
 *     "version": "01KJDB3QXBAFRRXWRV3W8DBD9R",
 *     "doc-last-modified": "2026-02-26T16:02:12.000Z",
 *     "doc-last-modified-by": "joe@bloggs.org",
 *     "doc-path-hint": "/path/to/file.html",
 *     "version-date": "2026-02-26T16:04:36.000Z",
 *     "version-by": "joe@bloggs.org",
 *     "version-operation": "preview"
 *   },
 *   {
 *     "version": "01KJDB2TW1AWCD1P7TMRZMBCT1",
 *     "doc-last-modified": "2026-02-26T16:04:06.000Z",
 *     "doc-last-modified-by": "joe@bloggs.org, harry@bloggs.org",
 *     "doc-path-hint": "/path/to/file.html",
 *     "version-by": "mel@bloggs.org",
 *     "version-date": "2026-02-26T16:04:06.000Z",
 *     "version-operation": "version",
 *     "version-comment": "ready for approval"
 *   }
 * ]
 *
 * @param {import('@adobe/helix-shared-storage').HelixStorageBucket} bucket
 *   bucket to access the source file
 * @param {string} versionDirKey key of the version directory
 * @returns {Promise<Response>} response with the file body and metadata
 */
async function listVersions(bucket, versionDirKey) {
  const list = await bucket.list(versionDirKey, { shallow: true, includePrefixes: false });
  if (!list || list.length === 0) {
    return handleNoVersions();
  }

  const versions = [];
  await processQueue(list, async (item) => {
    const head = await bucket.head(item.key);
    if (head) {
      versions.push({
        version: item.path,
        'doc-last-modified': head.Metadata['doc-last-modified'],
        'doc-path-hint': head.Metadata['doc-path-hint'],
        'doc-last-modified-by': head.Metadata['doc-last-modified-by'],
        'version-date': item.lastModified,
        'version-by': head.Metadata['version-by'],
        ...(head.Metadata['version-comment'] && { 'version-comment': head.Metadata['version-comment'] }),
        ...(head.Metadata['version-operation'] && { 'version-operation': head.Metadata['version-operation'] }),
      });
    }
  });

  versions.sort((a, b) => a.version.localeCompare(b.version));
  return new Response(JSON.stringify(versions), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Handle GET operations on the /.versions API, return either a version listing
 * when the .../.versions endpoint is accessed, or a specific version for requests
 * to .../.versions/<someversion>
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {boolean} headRequest whether to return the headers only for a HEAD request
 * @returns {Promise<Response>} response with the file body and metadata
 */
export async function getOrListVersions(context, info, headRequest) {
  try {
    const segments = info.rawPath.split('/');
    const idx = segments.indexOf(VERSION_FOLDER);
    if (idx === -1) {
      return new Response('', { status: 400 });
    }

    const baseKey = getS3Key(info.org, info.site, segments.slice(0, idx).join('/'));
    const bucket = HelixStorage.fromContext(context).sourceBus();
    const head = await bucket.head(baseKey);
    const docId = getDocID(head);
    const versionDirKey = `${info.org}/${info.site}/${VERSION_FOLDER}/${docId}/`;

    // if segments ends with VERSION_FOLDER its a listing request
    if (segments[segments.length - 1] === VERSION_FOLDER) {
      return await listVersions(bucket, versionDirKey);
    }

    const versionId = segments[idx + 1];
    if (!isValid(versionId)) {
      // It's not a valid ULID
      throw new StatusCodeError('Not a valid version', 404);
    }

    const versionKey = `${versionDirKey}${versionId}`;
    return await accessSourceFile(context, versionKey, headRequest);
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
