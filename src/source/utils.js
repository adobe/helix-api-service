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
import { MEDIA_TYPES } from '../media/validate.js';
import { StatusCodeError } from '../support/StatusCodeError.js';

/**
 * We consider the following HTML errors to be acceptable and ignore them.
 */
const ACCEPTABLE_HTML_ERRORS = [
  'missing-doctype',
];

/**
 * Known content types for the source bus.
 */
export const CONTENT_TYPES = {
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Error messages from the media validation often start with this prefix.
 */
const PREVIEW_ERROR_PREFIX = 'Unable to preview';

/**
 * Get the content type from the extension.
 *
 * @param {string} ext extension
 * @return {string} content type
 * @throws {Error} with $metadata.httpStatusCode 400 if the content type is not found
 */
export function contentTypeFromExtension(ext) {
  const contentType = CONTENT_TYPES[ext.toLowerCase()];
  if (contentType) {
    return contentType;
  }
  const e = new Error(`Unknown file type: ${ext}`);
  e.$metadata = { httpStatusCode: 415 };
  throw e;
}

/**
 * Get the S3 key from the organization, site, and path.
 *
 * @param {string} org organization
 * @param {string} site site
 * @param {string} path document path
 * @returns {string} the S3 key
 */
export function getS3Key(org, site, path) {
  return `${org}/${site}${path}`;
}

/**
 * Get the source bus key from the request info.
 *
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {string} the source bus path
 */
export function getSourceKey(info) {
  const { org, site, resourcePath } = info;
  return getS3Key(org, site, resourcePath);
}

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

  // TODO Check HTML size limit

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

  // TODO check JSON size limit

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
    if (msg.startsWith(PREVIEW_ERROR_PREFIX)) {
      // Change the error message to not mention preview
      msg = msg.replace(PREVIEW_ERROR_PREFIX, 'Media not accepted');
    }
    throw new StatusCodeError(msg, 400);
  }
  return body;
}

/**
 * Validate the body stored in the request info.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} mime media type
 * @returns {Promise<Buffer>} body the message body as buffer
 */
export async function validateUpload(context, info, mime) {
  switch (mime) {
    case 'text/html':
      return validateHtml(context, info);
    case 'application/json':
      return validateJson(context, info);
    default:
      return validateMedia(context, info, mime);
  }
}
