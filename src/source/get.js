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
import { listFolder } from './folder.js';
import { accessSourceFile, getS3KeyFromInfo } from './utils.js';
import { getVersions, VERSION_FOLDER } from './versions.js';

async function accessSource(context, info, headRequest) {
  if (info.rawPath.endsWith('/')) {
    return listFolder(context, info, headRequest);
  } else if (info.rawPath.includes(VERSION_FOLDER)) {
    return getVersions(context, info, headRequest);
  }

  const { log } = context;
  const key = getS3KeyFromInfo(info);

  try {
    return await accessSourceFile(context, key, headRequest);
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
