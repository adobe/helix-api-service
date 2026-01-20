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
import { createErrorResponse } from '../contentbus/utils.js';
import { putSourceFile } from './put.js';
import {
  contentTypeFromExtension,
  FOLDER_MARKER,
  getS3Key,
  getSourceKey,
  getValidPayload,
  validateFolderPath,
} from './utils.js';

/**
 * Create a folder in the source bus, by creating a directory marker file.
 * The folder name must end with a slash and has to be of sanitized form.
 *
 * @param {import('../support/AdminContext.js').AdminContext} context context
 * @param {import('../support/RequestInfo.js').RequestInfo} info request info
 * @return {Promise<Response>} response
 */
export async function createFolder(context, info) {
  const { org, site, rawPath: path } = info;

  try {
    validateFolderPath(path);
    const key = getS3Key(org, site, `${path}${FOLDER_MARKER}`);

    return await putSourceFile(context, key, 'application/json', '{}');
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
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

  try {
    const mime = contentTypeFromExtension(info.ext);
    const body = await getValidPayload(context, info, mime, true);

    // TODO store images HTML from the outside in the media bus

    const key = getSourceKey(info);
    return putSourceFile(context, key, mime, body);
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
