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
  MAX_SOURCE_BUCKET_RETRY,
} from './utils.js';
import { postVersion } from './versions.js';

/**
 * Copy an S3 object and handle conflichts.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} srcKey source S3 key
 * @param {string} destKey destination S3 key
 * @param {boolean} move true if this is a move operation
 * @param {object} initialOpts metadata options for the copy operation
 * @param {object} collOpts collision options (e.g { copy: 'overwrite' } )
 */
async function copyWithRetry(
  context,
  srcKey,
  destKey,
  move,
  initialOpts,
  collOpts,
) {
  const bucket = HelixStorage.fromContext(context).sourceBus();
  let opts = initialOpts;

  // We start with assuming that there is nothing at the destination, the happy path
  let copyOpts = { IfNoneMatch: '*' };

  const maxRetry = context.attributes.maxSourceBucketRetry ?? MAX_SOURCE_BUCKET_RETRY;
  let attempt = 0;
  while (true) {
    try {
      const allOpts = { copyOpts, ...opts };
      // eslint-disable-next-line no-await-in-loop
      await bucket.copy(srcKey, destKey, allOpts);

      break; // copy was successful, break out of the loop - we're done!
    } catch (e) {
      attempt += 1;
      if (attempt > maxRetry) {
        throw e;
      }

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
            throw new StatusCodeError('Collision: something is at the destination already, no overwrite option provided', 409);
          }

          // eslint-disable-next-line no-await-in-loop
          const dest = await bucket.head(destKey);

          // version what's there before overwriting it, provide the destination ETag so that we
          // know we're versioning what we just did a head() of.
          // eslint-disable-next-line no-await-in-loop
          const versionResp = await postVersion(context, destKey, 'copy', 'Version created before overwrite', dest.ETag);
          if (versionResp.status !== 201) {
            if (versionResp.status !== 412 && versionResp.status !== 409) {
              throw new StatusCodeError('Failed to version the destination', versionResp.status);
            }
          } else {
            // Creating the version was successful, so we can now copy over the destination.

            const getDestDocId = getDocID(dest);

            // If something is at the destination already, we copy over that file, but keep
            // the doc ID from the destination as-is so that the destination keeps its history.
            opts = { ...initialOpts, addMetadata: { 'doc-id': getDestDocId } };

            // Now only copy over the destination if it's still the same as what we did a head() of
            copyOpts = { IfMatch: dest.ETag };
          }
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
  if (!move) {
    opts.addMetadata = { 'doc-id': ulid() };
  }
  await copyWithRetry(context, srcKey, destKey, move, opts, collOpts);
}

/**
 * Copies a document from the source to the destination.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} src source S3 key
 * @param {import('../support/RequestInfo').RequestInfo} info destination info
 * @param {boolean} move whether to move the source
 * @param {object} collOpts collision options
 * @returns {Promise<Array<{src: string, dst: string}>>} the copied file details
 */
async function copyDocument(context, src, info, move, collOpts) {
  const dst = getS3KeyFromInfo(info);
  await copyFile(context, src, dst, move, collOpts);
  return [{ src, dst }];
}

/**
 * Copies a folder from the source to the destination.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} srcKey source S3 key
 * @param {import('../support/RequestInfo').RequestInfo} info destination info
 * @param {boolean} move whether to move the source
 * @param {object} collOpts collision options
 * @returns {Promise<Array<{src: string, dst: string}>>} the copied files
 */
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
