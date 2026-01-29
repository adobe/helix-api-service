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
import { checkConditionals } from './header-utils.js';
import {
  contentTypeFromExtension,
  getS3KeyFromInfo,
  getS3Key,
  getValidPayload,
  storeSourceFile,
} from './utils.js';

/**
 * Copies a resource of a folder to the destination folder. If a folder is
 * copied, this is done recursively.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
async function copySource(context, info) {
  const { log } = context;
  const { source } = context.data;

  try {
    const srcKey = getS3Key(info.org, info.site, source);
    const bucket = HelixStorage.fromContext(context).sourceBus();

    const isFolder = info.rawPath.endsWith('/');
    if (isFolder !== srcKey.endsWith('/')) {
      return createErrorResponse({ status: 400, msg: 'Source and destination type mismatch', log });
    }

    let copied;
    if (isFolder) {
      const destKey = getS3Key(info.org, info.site, info.rawPath);
      copied = await bucket.copyDeep(srcKey, destKey);
    } else {
      const destKey = getS3KeyFromInfo(info);
      await bucket.copy(srcKey, destKey);
      copied = [{ src: srcKey, dst: destKey }];
    }
    const headers = { 'Content-Type': 'application/json' };
    return new Response(`{"copied": ${JSON.stringify(copied)}}`, { status: 200, headers });
  } catch (e) {
    const opts = { e, log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}

/**
 * Put into the source bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response
*/
export async function putSource(context, info) {
  if (context.data.source) {
    return copySource(context, info);
  }

  try {
    const condFailedResp = await checkConditionals(context, info);
    if (condFailedResp) {
      return condFailedResp;
    }

    const mime = contentTypeFromExtension(info.ext);
    const body = await getValidPayload(context, info, mime);

    const key = getS3KeyFromInfo(info);
    return await storeSourceFile(context, key, mime, body);
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
