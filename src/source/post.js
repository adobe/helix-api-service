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
import { createFolder } from './folder.js';
import { checkConditionals } from './header-utils.js';
import {
  contentTypeFromExtension,
  getS3KeyFromInfo,
  getValidPayload,
  storeSourceFile,
} from './utils.js';
import { createVersion } from './versions.js';

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
  } else if (info.rawPath.endsWith('/.versions')) {
    return createVersion(context, info);
  }

  try {
    const condFailedResp = await checkConditionals(context, info);
    if (condFailedResp) {
      return condFailedResp;
    }

    const mime = contentTypeFromExtension(info.ext);
    const body = await getValidPayload(context, info, mime, true);

    const key = getS3KeyFromInfo(info);
    return storeSourceFile(context, key, mime, body);
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
