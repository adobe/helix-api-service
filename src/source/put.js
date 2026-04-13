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
import { checkConditionals } from './header-utils.js';
import { getDocPathFromS3Key, getS3Key, getS3KeyFromInfo } from './s3-path-utils.js';
import {
  CopyOptions, copyFolder, copyDocument, storeSourceFile,
} from './source-client.js';
import { contentTypeFromExtension, getValidPayload } from './utils.js';

/**
 * Copies a resource of a folder to the destination folder. If a folder is
 * copied, this is done recursively.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {boolean} move whether to move the source
 * @returns {Promise<Response>} response
 */
async function copySource(context, info, move, collOpts) {
  const { log } = context;
  const { source } = context.data;

  try {
    const srcKey = getS3Key(info.org, info.site, source);

    const isFolder = info.rawPath.endsWith('/');
    if (isFolder !== srcKey.endsWith('/')) {
      return createErrorResponse({ status: 400, msg: 'Source and destination type mismatch', log });
    }

    const copyOpts = new CopyOptions({
      src: srcKey, info, move, collOpts,
    });
    const copied = isFolder
      ? await copyFolder(context, copyOpts)
      : await copyDocument(context, copyOpts);

    // The copied paths returned are without the org and site segments
    const copiedPaths = copied.map((c) => ({
      src: getDocPathFromS3Key(c.src),
      dst: getDocPathFromS3Key(c.dst),
    }));

    const operation = move ? 'moved' : 'copied';
    return new Response({
      [operation]: copiedPaths,
    });
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
    const move = String(context.data.move) === 'true';
    const collOpts = {
      collision: context.data.collision,
    };
    return copySource(context, info, move, collOpts);
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
