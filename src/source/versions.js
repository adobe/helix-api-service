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
import { isValid, ulid } from 'ulid';
import { createErrorResponse } from '../contentbus/utils.js';
import {
  accessSourceFile,
  getS3Key,
  getDocID,
  getUser,
  MAX_RETRY_RECURSION,
} from './utils.js';

export const VERSION_FOLDER = '.versions';

function handleNoVersions() {
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': '2',
  };
  return new Response('[]', { status: 200, headers });
}

async function getVersionInfo(item, bucket, versions) {
  const head = await bucket.head(item.key);
  if (head) {
    versions.push({
      version: item.path,
      date: item.lastModified,
      user: head.Metadata['version-user'],
      'doc-path': head.Metadata['doc-path'],
      ...(head.Metadata['version-comment'] && { comment: head.Metadata['version-comment'] }),
      ...(head.Metadata['version-operation'] && { operation: head.Metadata['version-operation'] }),
    });
  }
}

/**
 * List all versions of a file returned in order from old to new.
 * The response is a JSON array of objects with version information.
 * For example:
 * [
 *   {
 *     "version": "01KJDB3QXBAFRRXWRV3W8DBD9R",
 *     "date": "2026-02-26T16:04:36.000Z",
 *     "user": "joe@bloggs.org",
 *     "doc-path": "/path/to/file.html",
 *     "operation": "preview"
 *   },
 *   {
 *     "version": "01KJDB2TW1AWCD1P7TMRZMBCT1",
 *     "date": "2026-02-26T16:04:06.000Z",
 *     "user": "mel@bloggs.org",
 *     "doc-path": "/path/to/file.html",
 *     "operation": "version",
 *     "comment": "ready for approval"
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
  await processQueue(list, async (item) => getVersionInfo(item, bucket, versions));

  // sort objects in the versions array by date descending
  versions.sort((a, b) => b.date - a.date);

  return new Response(JSON.stringify(versions), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function getVersion(context, versionDirKey, version, headRequest) {
  const versionKey = `${versionDirKey}${version}`;
  return accessSourceFile(context, versionKey, headRequest);
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
export async function getVersions(context, info, headRequest) {
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
      return new Response('Not a valid version', { status: 404 });
    }
    return await getVersion(context, versionDirKey, versionId, headRequest);
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}

/**
 * Create a version of the source file.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} baseKey base key of the source file, must not start with a slash
 * @param {string} operation operation that triggered the version creation
 * @param {string} comment comment for the version
 * @param {number} recursion recursion count
 * @returns {Promise<Response>} response with the file body and metadata
 */
export async function postVersion(context, baseKey, operation, comment, recursion = 0) {
  if (baseKey.startsWith('/')) {
    return new Response('', { status: 400 });
  }

  try {
    const bucket = HelixStorage.fromContext(context).sourceBus();

    const head = await bucket.head(baseKey);
    if (!head) {
      return new Response('', { status: 404 });
    }

    const id = getDocID(head);
    const versionFolderKey = `${context.config.org}/${context.config.site}/${VERSION_FOLDER}/${id}/`;
    const pathName = `/${baseKey.split('/').slice(2).join('/')}`;

    const versionId = ulid();
    const versionKey = `${versionFolderKey}${versionId}`;

    const addMetadata = {
      'doc-path-hint': pathName,
      'version-user': getUser(context),
      ...(comment && { 'version-comment': comment }),
      ...(operation && { 'version-operation': operation }),
    };
    const copyOpts = { CopySourceIfMatch: head.ETag };

    try {
      await bucket.copy(baseKey, versionKey, { addMetadata, copyOpts });
    } catch (e) {
      if (recursion >= MAX_RETRY_RECURSION) throw e;

      if (e.$metadata?.httpStatusCode === 412) {
        // The source object has been modified since we last checked, so we need to redo
        return postVersion(context, baseKey, operation, comment, recursion + 1);
      }

      throw e;
    }
    const headers = {
      Location: `/${context.config.org}/sites/${context.config.site}/source${pathName}/${VERSION_FOLDER}/${versionId}`,
    };

    return new Response('', { status: 201, headers });
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
