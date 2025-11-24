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
import { accessDirListing } from './list.js';
import { getSourcePath } from './utils.js';

/**
 * Get the headers for the response.
 *
 * @param {*} meta The metadata that contains many of the headers
 * @param {number} length The content length
 * @return {Object} headers
 */
function getHeaders(meta, length) {
  const headers = {
    'Content-Type': meta.ContentType,
    'Last-Modified': meta.LastModified.toUTCString(),
  };
  if (length) {
    headers['Content-Length'] = length;
  }
  if (meta.ETag) {
    headers.ETag = meta.ETag;
  }
  return headers;
}

async function accessSource(context, info, headRequest) {
  if (info.rawPath.endsWith('/')) {
    return accessDirListing(context, info, headRequest);
  }
  const { log } = context;

  const bucket = HelixStorage.fromContext(context).sourceBus();
  const path = getSourcePath(info);

  try {
    if (headRequest) {
      const head = await bucket.head(path);
      if (!head) {
        return new Response('', { status: 404 });
      }

      const headers = getHeaders(head, head.ContentLength);
      return new Response('', { status: head.$metadata.httpStatusCode, headers });
    } else {
      const meta = {};
      const body = await bucket.get(path, meta);
      if (!body) {
        return new Response('', { status: 404 });
      }

      const headers = getHeaders(meta, body.length);
      return new Response(body, { status: 200, headers });
    }
  } catch (e) {
    const opts = { e, log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}

/**
 * Get from the source bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response with the document body and metadata
 */
export async function getSource(context, info) {
  return accessSource(context, info, false);
}

/**
 * Head request on the source bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response with the headers and metadata
*/
export async function headSource(context, info) {
  return accessSource(context, info, true);
}
