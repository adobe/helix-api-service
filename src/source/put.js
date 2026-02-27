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
import { checkConditionals } from './header-utils.js';
import {
  contentTypeFromExtension,
  getS3KeyFromInfo,
  getS3Key,
  getValidPayload,
  storeSourceFile,
  MAX_RETRY_RECURSION,
} from './utils.js';

/**
 * Copy an S3 object and handle conflichts.
 *
 * @param {string} srcKey source S3 key
 * @param {string} destKey destination S3 key
 * @param {Bucket} bucket the S3 bucket
 * @param {boolean} move true if this is a move operation
 * @param {object} opts metadata options for the copy operation
 * @param {object} copyOpts copy options
 * @param {number} recursion recursion count
 */
async function copyWithRetry(srcKey, destKey, bucket, move, opts, copyOpts, recursion = 0) {
  try {
    const allOpts = { copyOpts, ...opts };
    await bucket.copy(srcKey, destKey, allOpts);

    if (move) {
      const resp = await bucket.remove(srcKey);
      if (resp.$metadata?.httpStatusCode !== 204) {
        throw new Error(`Failed to remove source: ${srcKey}`);
      }
    }
  } catch (e) {
    if (recursion >= MAX_RETRY_RECURSION) throw e;

    const status = e.$metadata?.httpStatusCode;

    // As per S3 docs, retry on a 409
    if (status === 409) {
      await copyWithRetry(srcKey, destKey, bucket, move, opts, copyOpts, recursion + 1);
      return;
    }

    if (status !== 412) throw e;
    // 412: precondition failed - something is at the destination already.

    // If something is at the destination already, we copy over that file, but keep
    // dest ULID from the destination as-is so that the destination keeps its history.
    const dest = await bucket.head(destKey);

    const destULID = dest.Metadata.uuid;
    const newOpts = { ...opts, addMetadata: { ...opts.addMetadata, ulid: destULID } };
    const newCopyOpts = { IfMatch: dest.ETag };
    await copyWithRetry(srcKey, destKey, bucket, move, newOpts, newCopyOpts, recursion + 1);
  }
}

async function copyFile(srcKey, destKey, bucket, move) {
  const opts = {};
  const copyOpts = {};
  if (!move) {
    opts.addMetadata = { ulid: ulid() };
    copyOpts.IfNoneMatch = '*';
  }
  await copyWithRetry(srcKey, destKey, bucket, move, opts, copyOpts);
}

async function copyDocument(src, info, bucket, move) {
  const dst = getS3KeyFromInfo(info);
  await copyFile(src, dst, bucket, move);
  return [{ src, dst }];
}

async function copyFolder(srcKey, info, bucket, move) {
  const tasks = [];
  const destKey = getS3Key(info.org, info.site, info.rawPath);
  (await bucket.list(srcKey)).forEach((obj) => {
    tasks.push({
      src: obj.key,
      dst: `${destKey}${obj.path}`,
    });
  });

  const copied = [];
  await processQueue(tasks, async (task) => {
    await copyFile(task.src, task.dst, bucket, move);
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
async function copySource(context, info, move) {
  const { log } = context;
  const { source } = context.data;

  try {
    const srcKey = getS3Key(info.org, info.site, source);

    const isFolder = info.rawPath.endsWith('/');
    if (isFolder !== srcKey.endsWith('/')) {
      return createErrorResponse({ status: 400, msg: 'Source and destination type mismatch', log });
    }

    const bucket = HelixStorage.fromContext(context).sourceBus();
    const copied = isFolder
      ? await copyFolder(srcKey, info, bucket, move)
      : await copyDocument(srcKey, info, bucket, move);

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
    return copySource(context, info, String(context.data.move) === 'true');
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
