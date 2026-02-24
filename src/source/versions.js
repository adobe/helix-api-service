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
import { HelixStorage } from '@adobe/helix-shared-storage';
import { createErrorResponse } from '../contentbus/utils.js';
import {
  accessSourceFile,
  getFileHeaders,
  getS3Key,
  getUser,
} from './utils.js';

export const VERSION_FOLDER = '/.versions';
const VERSION_INDEX = 'index.json';

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

/**
 * List all versions of a file. The response is a JSON array of version objects:
 * For example:
 *   [{
 *     "version": 1,
 *     "comment": "initial version",
 *     "op": "version",
 *     "date": "2026-02-03T11:49:22.632Z",
 *     "user": "joe@bloggs.org"
 *   }, {
 *     "version": 2,
 *     "op": "preview",
 *     "date": "2026-02-03T11:49:22.632Z",
 *     "user": "harry@bloggs.org"
 *   }]
 *
 * @param {import('@adobe/helix-shared-storage').HelixStorageBucket} bucket
 *   bucket to access the source file
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} baseKey base key of the source file
 * @param {string} versionDirKey key of the version directory
 * @param {boolean} headRequest whether to return the headers only for a HEAD request
 * @returns {Promise<Response>} response with the file body and metadata
 */
async function listVersions(bucket, context, baseKey, versionDirKey, headRequest) {
  const indexKey = `${versionDirKey}${VERSION_INDEX}`;

  if (headRequest) {
    const head = await bucket.head(indexKey);
    if (!head) {
      return handleNoVersions();
    }
    const headers = getFileHeaders(head);
    return new Response('', { status: head.$metadata.httpStatusCode, headers });
  } else {
    const meta = {};
    const idx = await bucket.get(indexKey, meta);
    if (!idx) {
      return handleNoVersions();
    }
    const index = JSON.parse(idx);
    const headers = getFileHeaders(meta);
    return new Response(JSON.stringify(index.versions), { status: 200, headers });
  }
}

async function getVersion(context, versionDirKey, version, headRequest) {
  const versionKey = `${versionDirKey}${version}`;
  try {
    return await accessSourceFile(context, versionKey, headRequest);
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}

/**
 * Handle GET operations on the /.versions API
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {boolean} headRequest whether to return the headers only for a HEAD request
 * @returns {Promise<Response>} response with the file body and metadata
 */
export async function getVersions(context, info, headRequest) {
  try {
    const idx = info.rawPath.indexOf(VERSION_FOLDER);
    if (idx === -1) {
      return new Response('', { status: 404 });
    }

    // Obtain the UUID of the version storage root
    const baseKey = getS3Key(info.org, info.site, info.rawPath.slice(0, idx));

    const bucket = HelixStorage.fromContext(context).sourceBus();
    const head = await bucket.head(baseKey);
    if (!head?.Metadata?.uuid) {
      return new Response('', { status: 404 });
    }
    const versionDirKey = `${getSiteRoot(info)}${VERSION_FOLDER}/${head.Metadata.uuid}/`;

    if (info.rawPath.endsWith(VERSION_FOLDER)) {
      return listVersions(bucket, context, baseKey, versionDirKey, headRequest);
    }

    // We expect a '/' between '.versions' and the number
    if (info.rawPath[idx + VERSION_FOLDER.length] !== '/') {
      return new Response('', { status: 400 });
    }

    const version = info.rawPath.slice(idx + VERSION_FOLDER.length + 1);
    if (Number.isNaN(version)) {
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
 * @returns {Promise<Response>} response with the file body and metadata
 */
export async function postVersion(context, baseKey, info) {
  const { log } = context;

  try {
    const bucket = HelixStorage.fromContext(context).sourceBus();

    const head = await bucket.head(baseKey);
    if (!head) {
      return new Response('', { status: 404 });
    }

    const uuid = head.Metadata?.uuid;
    if (!uuid) {
      return new Response('Document without UUID', { status: 500 });
    }

    const versionFolderKey = `${getSiteRoot(info)}${VERSION_FOLDER}/${uuid}/`;
    const indexKey = `${versionFolderKey}${VERSION_INDEX}`;
    const comment = String(context.data.comment || '');
    const operation = String(context.data.operation || '');

    const idx = await bucket.get(indexKey);
    let index;
    if (idx) {
      index = JSON.parse(idx);
    } else {
      index = {
        versions: [],
      };
    }

    const versionNr = index.versions.length + 1;
    const versionKey = `${versionFolderKey}${versionNr}`;
    const renameMetadata = { uuid: 'org-uuid' };
    const addMetadata = { 'org-path': baseKey };
    await bucket.copy(baseKey, versionKey, { renameMetadata, addMetadata });

    const version = {
      version: versionNr,
      date: new Date().toISOString(),
      user: getUser(context),
      ...(comment && { comment }),
      ...(operation && { operation }),
    };
    index.versions.push(version);

    await bucket.put(indexKey, JSON.stringify(index, null, 2), 'application/json');

    const headers = {
      Location: `/${info.org}/sites/${info.site}/source${info.resourcePath}/${versionNr}`,
    };

    return new Response('', { status: 201, headers });
  } catch (e) {
    const opts = { e, log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
