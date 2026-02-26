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
import { accessSourceFile, getS3Key, getUser } from './utils.js';

export const VERSION_FOLDER = '/.versions';

function getSiteRoot(info) {
  const { org, site } = info;
  return `${org}/${site}`;
}

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
      'org-path': head.Metadata['org-path'],
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
 *     "org-path": "/path/to/file.html",
 *     "op": "preview"
 *   },
 *   {
 *     "version": "01KJDB2TW1AWCD1P7TMRZMBCT1",
 *     "date": "2026-02-26T16:04:06.000Z",
 *     "user": "mel@bloggs.org",
 *     "org-path": "/path/to/file.html",
 *     "op": "version",
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
  versions.sort((a, b) => b.date > a.date);

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
    const idx = info.rawPath.indexOf(VERSION_FOLDER);
    if (idx === -1) {
      return new Response('', { status: 400 });
    }

    const baseKey = getS3Key(info.org, info.site, info.rawPath.slice(0, idx));

    const bucket = HelixStorage.fromContext(context).sourceBus();
    const head = await bucket.head(baseKey);
    if (!head?.Metadata?.ulid) {
      return new Response('', { status: 404 });
    }
    const versionDirKey = `${getSiteRoot(info)}${VERSION_FOLDER}/${head.Metadata.ulid}/`;

    if (info.rawPath.endsWith(VERSION_FOLDER)) {
      return listVersions(bucket, versionDirKey);
    }

    // We expect a '/' between '.versions' and the number
    if (info.rawPath[idx + VERSION_FOLDER.length] !== '/') {
      return new Response('', { status: 400 });
    }

    const version = info.rawPath.slice(idx + VERSION_FOLDER.length + 1);
    if (!isValid(version)) {
      // It's not a valid ULID
      return new Response('', { status: 400 });
    }
    return getVersion(context, versionDirKey, version, headRequest);
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
 * @param {string} baseKey base key of the source file
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response with the file body and metadata
 */
export async function postVersion(context, baseKey, info) {
  try {
    const bucket = HelixStorage.fromContext(context).sourceBus();

    const head = await bucket.head(baseKey);
    if (!head) {
      return new Response('', { status: 404 });
    }

    const id = head.Metadata?.ulid;
    if (!id) {
      throw new Error('Document without ULID');
    }

    const versionFolderKey = `${getSiteRoot(info)}${VERSION_FOLDER}/${id}/`;
    const pathName = `/${baseKey.split('/').slice(2).join('/')}`;
    const comment = String(context.data.comment || '');
    const operation = String(context.data.operation || '');

    const versionULID = ulid();
    const versionKey = `${versionFolderKey}${versionULID}`;

    const renameMetadata = { ulid: 'org-ulid' };
    const addMetadata = {
      'org-path': pathName,
      'version-user': getUser(context),
      ...(comment && { 'version-comment': comment }),
      ...(operation && { 'version-operation': operation }),
    };

    await bucket.copy(baseKey, versionKey, { renameMetadata, addMetadata });
    const headers = {
      Location: `/${info.org}/sites/${info.site}/source${info.resourcePath}/${versionULID}`,
    };

    return new Response('', { status: 201, headers });
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
