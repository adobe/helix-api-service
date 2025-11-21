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
import { createErrorResponse } from '../contentbus/utils.js';
import { getSourceBucket, getSourcePath } from './utils.js';

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html',
};

/**
 * Get the content type from the extension.
 *
 * @param {string} ext extension
 * @return {string} content type
 * @throws {Error} with $metadata.httpStatusCode 400 if the content type is not found
 */
function contentTypeFromExtension(ext) {
  const contentType = CONTENT_TYPES[ext];
  if (contentType) {
    return contentType;
  }
  const e = new Error(`Unknown file type: ${ext}`);
  e.$metadata = { httpStatusCode: 415 };
  throw e;
}

/**
 * Get the user from the context and return their email.
 * If no user is found, return 'anonymous'.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @return {string} user or 'anonymous'
 */
function getUser(context) {
  const email = context.attributes.authInfo?.profile?.email;

  return email || 'anonymous';
}

/**
 * Put into the source bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response
*/
export async function putSource(context, info) {
  const { log } = context;

  const bucket = getSourceBucket(context);
  const path = getSourcePath(info);

  try {
    const body = await info.buffer();
    const resp = await bucket.put(path, body, contentTypeFromExtension(info.ext), {
      'Last-Modified-By': getUser(context),
    });

    const status = resp.$metadata.httpStatusCode === 200 ? 201 : resp.$metadata.httpStatusCode;
    return new Response('', { status });
  } catch (e) {
    const opts = { e, log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
