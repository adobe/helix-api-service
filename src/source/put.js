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
import { contentTypeFromExtension, getSourceKey, validateUpload } from './utils.js';

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
 * Put file based on key and body in the source bus.
 * The file is assumes already have been validated.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} key key to store the file at (including extension)
 * @param {string} mime the mime type of the file
 * @param {Buffer} body content body
 * @returns {Promise<Response>} response
 */
export async function putSourceFile(context, key, mime, body) {
  const bucket = HelixStorage.fromContext(context).sourceBus();

  const resp = await bucket.put(key, body, mime, {
    'Last-Modified-By': getUser(context),
    'Uncompressed-Length': String(body.length),
  }, true);

  const status = resp.$metadata.httpStatusCode === 200 ? 201 : resp.$metadata.httpStatusCode;
  return new Response('', { status });
}

/**
 * Put into the source bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response
*/
export async function putSource(context, info) {
  try {
    const mime = contentTypeFromExtension(info.ext);
    const body = await validateUpload(context, info, mime);

    // TODO for HTML ensure no references to external images

    const key = getSourceKey(info);
    return await putSourceFile(context, key, mime, body);
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
