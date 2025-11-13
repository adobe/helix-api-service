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
import { error } from '../contentproxy/errors.js';
import { errorResponse } from '../support/utils.js';
import { fetchMedia } from './fetch.js';
import { storeBlob } from './store.js';
import { MEDIA_TYPES } from './validate.js';

/**
 * Allowed methods for that handler
 */
const ALLOWED_METHODS = ['POST'];

/**
 * Upload to media bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response
 */
async function upload(context, info) {
  const { log } = context;
  const { headers } = info;

  let buffer;

  // fetch media body, either from URL or directly
  let contentType = headers['content-type'];
  if (contentType === 'application/x-www-form-urlencoded' || contentType === 'application/json') {
    const { url } = context.data;
    if (!url) {
      return new Response('', { status: 400, headers: { 'x-error': 'missing URL' } });
    }
    const ret = await fetchMedia(context, url);
    if (ret.error) {
      return errorResponse(log, 502, ret.error);
    }
    ({ buffer, contentType } = ret);
  } else {
    buffer = await info.buffer();
    if (buffer.length === 0) {
      return new Response('', { status: 400, headers: { 'x-error': 'missing media in request body' } });
    }
  }

  // preprocess and validate media
  const mediaType = MEDIA_TYPES.find((type) => type.mime === contentType);
  if (!mediaType) {
    return errorResponse(log, 415, error(
      'File type not supported: $1',
      contentType,
    ));
  }
  const { preprocess, validate } = mediaType;
  if (preprocess) {
    buffer = await preprocess(buffer, log);
  }
  if (validate) {
    try {
      await validate(context, 'unnamed', buffer);
    } catch (e) {
      return errorResponse(log, 409, e.reason);
    }
  }

  // store in media bus
  const blob = await storeBlob(context, info, buffer, contentType);

  const { meta, uri } = blob;
  return new Response(JSON.stringify({
    uri,
    meta: {
      type: blob.contentType,
      ...Object.fromEntries(Object.entries(meta).filter(([key]) => ['width', 'height'].includes(key))),
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * Handles the media route
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response
 */
export default async function mediaHandler(context, info) {
  const { attributes: { authInfo } } = context;

  if (ALLOWED_METHODS.indexOf(info.method) < 0) {
    return new Response('method not allowed', {
      status: 405,
    });
  }
  authInfo.assertPermissions('media:upload');
  return upload(context, info);
}
