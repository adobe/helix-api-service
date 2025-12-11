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
import { fromHtml } from 'hast-util-from-html';
import { createErrorResponse } from '../contentbus/utils.js';
import { MEDIA_TYPES } from '../media/validate.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { createFolder } from './folder.js';
import { putSourceFile } from './put.js';
import { contentTypeFromExtension, getSourceKey } from './utils.js';

/**
 * We consider the following HTML errors to be acceptable and ignore them.
 */
const ACCEPTABLE_HTML_ERRORS = [
  'missing-doctype',
];

/**
 * Validate the HTML message body stored in the request info.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Buffer>} body the message body as buffer
 */
export async function validateHtml(context, info) {
  function validateHtmlError(message) {
    const msg = `${message.message} - ${message.note}`;
    if (ACCEPTABLE_HTML_ERRORS.includes(message.ruleId)) {
      context.log.warn(`Ignoring HTML error: ${msg}`);
      return;
    }
    throw new StatusCodeError(msg, 400);
  }

  const body = await info.buffer();
  fromHtml(body.toString(), {
    onerror: validateHtmlError,
  });
  return body;
}

/**
 * Validate the JSON message body stored in the request info.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Buffer>} body the message body as buffer
 */
export async function validateJson(context, info) {
  const body = await info.buffer();

  try {
    JSON.parse(body.toString());
  } catch (e) {
    throw new StatusCodeError(`Invalid JSON: ${e.message}`, 400);
  }
  return body;
}

/**
 * Validate media body stored in the request info.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} mime media type
 * @returns {Promise<Buffer>} body the message body as buffer
 */
export async function validateMedia(context, info, mime) {
  const mediaType = MEDIA_TYPES.find((type) => type.mime === mime);
  if (!mediaType) {
    throw new StatusCodeError(`Unknown media type: ${mime}`, 400);
  }
  const body = await info.buffer();
  try {
    await mediaType.validate(context, info.resourcePath, body);
  } catch (e) {
    let msg = e.message;
    if (msg.startsWith('Unable to preview')) {
      // Change the error message to not mention preview
      msg = msg.replace('Unable to preview', 'Media not accepted');
    }
    throw new StatusCodeError(msg, 400);
  }
  return body;
}

/**
 * Handle POST requests to the source bus.
 *
 * Posting to a location ending with a slash will create a folder.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response
 */
export async function postSource(context, info) {
  if (info.rawPath.endsWith('/')) {
    return createFolder(context, info);
  }
  const { log } = context;

  try {
    const mime = contentTypeFromExtension(info.ext);
    let body;
    switch (mime) {
      case 'text/html':
        body = await validateHtml(context, info);
        break;
      case 'application/json':
        body = await validateJson(context, info);
        break;
      default:
        body = await validateMedia(context, info, mime);
        break;
    }

    const key = getSourceKey(info);
    return putSourceFile(context, key, mime, body);
  } catch (e) {
    const opts = { e, log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
