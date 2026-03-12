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
import processQueue from '@adobe/helix-shared-process-queue';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { ulid } from 'ulid';
import { createErrorResponse } from '../contentbus/utils.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { checkConditionals } from './header-utils.js';
import {
  contentTypeFromExtension,
  getS3KeyFromInfo,
  getS3Key,
  getDocID,
  getValidPayload,
  storeSourceFile,
  MAX_RETRY_RECURSION,
} from './utils.js';
import { postVersion } from './versions.js';

/**
 * Copy an S3 object and handle conflichts.
 *
 * @param {string} srcKey source S3 key
 * @param {string} destKey destination S3 key
 * @param {Bucket} bucket the S3 bucket
 * @param {boolean} move true if this is a move operation
 * @param {object} opts metadata options for the copy operation
 * @param {object} copyOpts copy options (passed to HelixStorage.copy)
 * @param {object} collOpts collision options
 */
async function copyWithRetry(
  context,
  srcKey,
  destKey,
  move,
  initialOpts,
  initialCopyOpts,
  collOpts,
) {
  const bucket = HelixStorage.fromContext(context).sourceBus();
  let versionCreated = false;
  let opts = initialOpts;
  let copyOpts = initialCopyOpts;

  for (let attempt = 0; attempt <= MAX_RETRY_RECURSION; attempt += 1) {
    try {
      const allOpts = { copyOpts, ...opts };
      // eslint-disable-next-line no-await-in-loop
      await bucket.copy(srcKey, destKey, allOpts);

      break; // copy was successful, break out of the loop
    } catch (e) {
      if (attempt >= MAX_RETRY_RECURSION) throw e;

      const status = e.$metadata?.httpStatusCode;

      // As per S3 docs, retry on a 409
      if (status !== 409) {
        if (status !== 412) throw e;
        // 412: precondition failed - something is at the destination already.

        if (move) {
          // TODO add move collision handling
          throw new StatusCodeError('Collision: something is at the destination already', 409);
        } else {
          if (collOpts.copy !== 'overwrite') {
            throw new StatusCodeError('Collision: something is at the destination already', 409);
          }

          // version what's there before overwriting it
          if (!versionCreated) {
            // eslint-disable-next-line no-await-in-loop
            const versionResp = await postVersion(context, destKey, 'copy');
            if (versionResp.status !== 201) {
              throw new StatusCodeError('Failed to version the destination', versionResp.status);
            }
            versionCreated = true;
          }

          // If something is at the destination already, we copy over that file, but keep
          // dest ULID from the destination as-is so that the destination keeps its history.
          // eslint-disable-next-line no-await-in-loop
          const dest = await bucket.head(destKey);

          const getDestDocId = getDocID(dest);
          opts = { ...initialOpts, addMetadata: { 'doc-id': getDestDocId } };
          copyOpts = { IfMatch: dest.ETag };
        }
      }
    }
  }

  if (move) {
    const resp = await bucket.remove(srcKey);
    if (resp.$metadata?.httpStatusCode !== 204) {
      throw new StatusCodeError(`Failed to remove source: ${srcKey}`, resp.$metadata?.httpStatusCode);
    }
  }
}

async function copyFile(context, srcKey, destKey, move, collOpts) {
  const opts = {};
  const copyOpts = {};
  if (!move) {
    opts.addMetadata = { 'doc-id': ulid() };
    copyOpts.IfNoneMatch = '*';
  }
  await copyWithRetry(context, srcKey, destKey, move, opts, copyOpts, collOpts);
}

async function copyDocument(context, src, info, move, collOpts) {
  const dst = getS3KeyFromInfo(info);
  await copyFile(context, src, dst, move, collOpts);
  return [{ src, dst }];
}

async function copyFolder(context, srcKey, info, move, collOpts) {
  const tasks = [];
  const destKey = getS3Key(info.org, info.site, info.rawPath);

  if (destKey.startsWith(srcKey)) {
    throw new StatusCodeError('Destination cannot be a subfolder of source', 400);
  }

  const bucket = HelixStorage.fromContext(context).sourceBus();
  (await bucket.list(srcKey)).forEach((obj) => {
    tasks.push({
      src: obj.key,
      dst: `${destKey}${obj.path}`,
    });
  });

  const copied = [];
  await processQueue(tasks, async (task) => {
    await copyFile(context, task.src, task.dst, move, collOpts);
    copied.push({ src: task.src, dst: task.dst });
  });
  return copied;
}

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

    const copied = isFolder
      ? await copyFolder(context, srcKey, info, move, collOpts)
      : await copyDocument(context, srcKey, info, move, collOpts);

    const operation = move ? 'moved' : 'copied';
    return new Response({
      [operation]: copied,
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
    const collOpts = {};
    if (move) {
      collOpts.move = context.data.collision;
    } else {
      collOpts.copy = context.data.collision;
    }
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
