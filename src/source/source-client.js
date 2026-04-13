/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { getS3KeyFromInfo, getS3Key } from './s3-path-utils.js';
import { getDocID, MAX_SOURCE_BUCKET_RETRY } from './utils.js';

export const VERSION_FOLDER = '.versions';
export class CopyOptions {
  /**
   * @param {object} options
   * @param {string} options.src source S3 key
   * @param {import('../support/RequestInfo').RequestInfo} options.info destination info
   * @param {boolean} options.move whether to move the source
   * @param {object} [options.opts] additional options for the copy operation
   * @param {function(string, string): object} [options.fnOpts] function returning per-file options,
   * called with source and destination S3 keys. Used by folder copies.
   * @param {object} options.collOpts collision options
   */
  constructor({
    src, info, move, opts = {}, fnOpts, collOpts,
  }) {
    this.src = src;
    this.info = info;
    this.move = move;
    this.opts = opts;
    this.fnOpts = fnOpts;
    this.collOpts = collOpts;
  }
}

/**
 * Get the headers for the source file response.
 *
 * @param {Object} meta The metadata that contains many of the headers
 * @param {number} length The content length
 * @return {Object} headers
 */
function getFileHeaders(meta, length) {
  const headers = {
    'Content-Type': meta.ContentType,
    'Last-Modified': meta.LastModified.toUTCString(),
  };
  if (length) {
    headers['Content-Length'] = length;
  }
  if (meta.ETag) {
    headers.ETag = meta.ETag;
  }
  return headers;
}

/**
 * Get the user from the context and return their email.
 * If no user is found, return 'anonymous'.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @return {string} user or 'anonymous'
 */
function getUser(context) {
  const email = context.attributes.authInfo?.profile?.email;

  return email || 'anonymous';
}

/**
 * Access a file from the source bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} key key to access the file at storage
 * @param {boolean} headRequest whether to return the headers only for a HEAD request
 * @returns {Promise<Response>} response with the file body and metadata
 */
export async function accessSourceFile(context, key, headRequest) {
  const bucket = HelixStorage.fromContext(context).sourceBus();
  if (headRequest) {
    const head = await bucket.head(key);
    if (!head) {
      return new Response('', { status: 404 });
    }

    const length = head.Metadata?.['uncompressed-length'] || head.ContentLength;
    const headers = getFileHeaders(head, length);
    return new Response('', { status: head.$metadata.httpStatusCode, headers });
  } else {
    const meta = {};
    const body = await bucket.get(key, meta);
    if (!body) {
      return new Response('', { status: 404 });
    }

    const headers = getFileHeaders(meta, body.length);
    return new Response(body, { status: 200, headers });
  }
}

/**
 * Create a version of the source file.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} baseKey base key of the source file, must not start with a slash
 * @param {string} operation operation that triggered the version creation
 * @param {string} comment comment for the version
 * @param {string} etag ETag of the source file to version (optional)
 * @returns {Promise<Response>} response with the file body and metadata
 */
export async function createVersion(context, baseKey, operation, comment, etag) {
  if (baseKey.startsWith('/')) {
    return new Response('', { status: 400 });
  }

  const { org, site } = context.config;

  try {
    const bucket = HelixStorage.fromContext(context).sourceBus();

    const maxRetry = context.attributes.maxSourceBucketRetry ?? MAX_SOURCE_BUCKET_RETRY;
    let attempt = 0;
    while (true) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const head = await bucket.head(baseKey);
        if (!head) {
          return new Response('', { status: 404 });
        }

        const id = getDocID(head);
        const versionFolderKey = `${org}/${site}/${VERSION_FOLDER}/${id}/`;
        const pathName = `/${baseKey.split('/').slice(2).join('/')}`;

        const versionId = ulid();
        const versionKey = `${versionFolderKey}${versionId}`;

        const addMetadata = {
          'doc-path-hint': pathName,
          'doc-last-modified': head.LastModified.toISOString(),
          'version-by': getUser(context),
          ...(comment && { 'version-comment': comment }),
          ...(operation && { 'version-operation': operation }),
        };
        const renameMetadata = {
          'last-modified-by': 'doc-last-modified-by',
        };
        const copyOpts = { CopySourceIfMatch: etag || head.ETag };

        // eslint-disable-next-line no-await-in-loop
        await bucket.copy(baseKey, versionKey, { addMetadata, renameMetadata, copyOpts });

        const headers = {
          Location: `/${org}/sites/${site}/source${pathName}/${VERSION_FOLDER}/${versionId}`,
        };

        // copy was successful, we're done
        return new Response('', { status: 201, headers });
      } catch (e) {
        attempt += 1;
        if (attempt > maxRetry) {
          throw e;
        }

        // Retry if we received a 412 precondition failed, but not if the etag was provided to
        // this function (because in that case looping were won't refesh the etag).
        if (e.$metadata?.httpStatusCode !== 412 || etag) {
          throw e;
        }

        // We end up when the response is a 412 Precondition Failed, which means that
        // the document that we're about to version has been changed since we obtained
        // its metadata. We need to redo the operation with fresh metadata.
      }
    }
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}

/**
 * Copy a file and handle conflicts, if the destination already exists. It will then retry
 * after taking the specified action to handle the conflict.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} srcKey source S3 key
 * @param {string} destKey destination S3 key
 * @param {boolean} move true if this is a move operation
 * @param {object} initialOpts metadata options for the copy operation
 * @param {object} collOpts collision options (e.g { collision: 'overwrite' } ),
 * these collision options are used to handle conflicts when copying the source to the
 * destination.
 * - 'overwrite' - overwrite the destination if it exists, but create a version of
 * the destination first.
 * - 'unique' - append a (base-36) encoded timestamp to the destination key to make it unique.
 * These timestamps are alphabetically sortable.
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
  let destinationKey = destKey;
  let opts = initialOpts;

  // We start with assuming that there is nothing at the destination, the happy path
  let copyOpts = { IfNoneMatch: '*' };

  const maxRetry = context.attributes.maxSourceBucketRetry ?? MAX_SOURCE_BUCKET_RETRY;
  let attempt = 0;
  while (true) {
    try {
      const allOpts = { copyOpts, ...opts };
      // eslint-disable-next-line no-await-in-loop
      await bucket.copy(srcKey, destinationKey, allOpts);

      break; // copy was successful, break out of the loop - we're done!
    } catch (e) {
      attempt += 1;
      if (attempt > maxRetry) {
        throw e;
      }

      const status = e.$metadata?.httpStatusCode;

      // As per S3 docs, retry on a 409
      if (status !== 409) {
        if (status !== 412) {
          throw e;
        }
        // 412: precondition failed - something is at the destination already.

        if (collOpts.collision === 'unique') {
          // The request is to move and make the destination file unique.
          // We do this by appending a ms timestamp to the destination key.

          const ext = `.${destKey.split('.').pop()}`;
          const destWithoutExt = destKey.slice(0, -ext.length);

          const ts = Date.now().toString(36);
          destinationKey = `${destWithoutExt}-${ts}${ext}`;
        } else if (collOpts.collision === 'overwrite') {
          // eslint-disable-next-line no-await-in-loop
          const dest = await bucket.head(destKey);

          // version what's there before overwriting it, provide the destination ETag so that we
          // know we're versioning what we just did a head() of.
          // eslint-disable-next-line no-await-in-loop
          const versionResp = await createVersion(context, destKey, 'copy', 'Version created before overwrite', dest.ETag);
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
        } else {
          throw new StatusCodeError('Collision: something is at the destination already', 409);
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

async function copyFile(context, srcKey, destKey, move, opts, collOpts) {
  const copyOpts = { ...opts };
  if (!move) {
    copyOpts.addMetadata = { 'doc-id': ulid() };
  }
  await copyWithRetry(context, srcKey, destKey, move, copyOpts, collOpts);
}

/**
 * Copies a document from the source to the destination.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {CopyOptions} copyOptions copy options
 * @returns {Promise<Array<{src: string, dst: string}>>} the copied file details
 */
export async function copyDocument(context, copyOptions) {
  const {
    src, info, move, opts, collOpts,
  } = copyOptions;
  const dst = getS3KeyFromInfo(info);
  await copyFile(context, src, dst, move, opts, collOpts);
  return [{ src, dst }];
}

/**
 * Copies a folder from the source to the destination.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {CopyOptions} copyOptions copy options
 * @returns {Promise<Array<{src: string, dst: string}>>} the copied files
 */
export async function copyFolder(context, copyOptions) {
  const {
    src: srcKey, info, move, fnOpts = () => ({}), collOpts,
  } = copyOptions;
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

  if (tasks.length === 0) {
    // Nothing found at source
    throw new StatusCodeError('Not found', 404);
  }

  const copied = [];
  await processQueue(tasks, async (task) => {
    const opts = fnOpts(task.src, task.dst);
    await copyFile(context, task.src, task.dst, move, opts, collOpts);
    copied.push({ src: task.src, dst: task.dst });
  });
  return copied;
}

/**
 * Store file based on key and body in the source bus.
 * The file is assumes already have been validated.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} key key to store the file at (including extension)
 * @param {string} mime the mime type of the file
 * @param {Buffer} body content body
 * @returns {Promise<Response>} response
 */
export async function storeSourceFile(context, key, mime, body) {
  const bucket = HelixStorage.fromContext(context).sourceBus();

  const head = await bucket.head(key);
  const id = head?.Metadata?.['doc-id'] || ulid();

  const resp = await bucket.put(key, body, mime, {
    'Last-Modified-By': getUser(context),
    'Uncompressed-Length': String(body.length),
    'doc-id': id,
  }, true);

  const status = resp.$metadata.httpStatusCode === 200 ? 201 : resp.$metadata.httpStatusCode;
  return new Response('', { status });
}
