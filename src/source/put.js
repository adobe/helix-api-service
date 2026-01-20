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
import { headSource } from './get.js';
import {
  contentTypeFromExtension,
  getSourceKey,
  getValidPayload,
  storeSourceFile,
} from './utils.js';

export async function checkConditionals(context, info) {
  const ifMatch = info.headers['if-match'] || null;

  let ifNoneMatch = null;
  if (!ifMatch) {
    // If both ifMatch and ifNoneMatch are present, prioritize ifMatch as per RFC 7232
    ifNoneMatch = info.headers['if-none-match'] || null;
  }

  if (ifMatch || ifNoneMatch) {
    const head = await headSource(context, info);
    const etag = head.headers.get('etag');

    if (ifMatch) {
      if (ifMatch === '*') {
        if (head.status === 404) {
          return new Response('', { status: 412 });
        }
      } else if (ifMatch !== etag) {
        return new Response('', { status: 412 });
      }
    } else if (ifNoneMatch) {
      if (ifNoneMatch === '*') {
        if (head.status !== 404) {
          return new Response('', { status: 412 });
        }
      } else if (ifNoneMatch === etag) {
        return new Response('', { status: 412 });
      }
    }
  }

  return null;
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
    const condFailedResp = await checkConditionals(context, info);
    if (condFailedResp) {
      return condFailedResp;
    }

    const mime = contentTypeFromExtension(info.ext);
    const body = await getValidPayload(context, info, mime);

    const key = getSourceKey(info);
    return await storeSourceFile(context, key, mime, body);
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
