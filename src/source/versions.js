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
import { RequestInfo } from '../support/RequestInfo.js';
import { createErrorResponse } from '../contentbus/utils.js';
import {
  accessSourceFile,
  getFileHeaders,
  getS3KeyFromInfo,
  getUser,
} from './utils.js';

const VERSION_INDEX = '/index.json';

/**
 * Create a version of the source file.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response with the file body and metadata
 */
export async function createVersion(context, info) {
  const key = getS3KeyFromInfo(info);
  const baseKey = key.slice(0, -'/.versions'.length);
  const indexKey = `${key}${VERSION_INDEX}`;
  const comment = String(context.data.comment || '');
  const operation = String(context.data.operation);

  try {
    const bucket = HelixStorage.fromContext(context).sourceBus();
    const idx = await bucket.get(indexKey);
    let index;
    if (idx) {
      index = JSON.parse(idx);
    } else {
      index = {
        versions: [],
        next: 1,
      };
    }

    const versionKey = `${key}/${index.next}`;
    await bucket.copy(baseKey, versionKey);

    index.versions.push({
      version: index.next,
      comment,
      op: operation,
      date: new Date().toISOString(),
      user: getUser(context),
    });
    index.next += 1;
    await bucket.put(indexKey, JSON.stringify(index), 'application/json');
    return new Response('', { status: 201 });
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
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
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {boolean} headRequest whether to return the headers only for a HEAD request
 * @returns {Promise<Response>} response with the file body and metadata
 */
export async function listVersions(context, info, headRequest) {
  const key = getS3KeyFromInfo(info);
  const indexKey = `${key}${VERSION_INDEX}`;
  const bucket = HelixStorage.fromContext(context).sourceBus();

  if (headRequest) {
    const head = await bucket.head(indexKey);
    if (!head) {
      return new Response('', { status: 404 });
    }
    const length = head.Metadata?.['uncompressed-length'] || head.ContentLength;
    const headers = getFileHeaders(head, length);
    return new Response('', { status: head.$metadata.httpStatusCode, headers });
  } else {
    const meta = {};
    const idx = await bucket.get(indexKey, meta);
    if (!idx) {
      return new Response('', { status: 404 });
    }
    const index = JSON.parse(idx);
    const headers = getFileHeaders(meta, idx.length);
    return new Response(JSON.stringify(index.versions), { status: 200, headers });
  }
}

/**
 * Get a specific version of a file.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} version version number
 * @param {boolean} headRequest whether to return the headers only for a HEAD request
 * @returns {Promise<Response>} response with the file body and metadata
 */
async function getVersion(context, info, version, headRequest) {
  const baseKey = getS3KeyFromInfo(info);
  const versionKey = `${baseKey}/.versions/${version}`;
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
  if (info.rawPath.endsWith('/.versions')) {
    return listVersions(context, info, headRequest);
  }

  // Parse the requested individual version out of the request info
  const match = info.rawPath.match(/\/\.versions\/(\d+)$/);
  if (match) {
    // If it matches return the requested version file.
    const baseInfo = RequestInfo.clone(info, { path: info.rawPath.slice(0, -match[0].length) });
    return getVersion(context, baseInfo, match[1], headRequest);
  }

  return new Response('', { status: 404 });
}
