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
import { RequestInfo } from '../support/RequestInfo.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { copyDocument, copyFolder } from './source-client.js';
import { getDocPathFromS3Key, getS3Key, getS3KeyFromInfo } from './utils.js';

/**
 * Trash a folder by moving all of its contents to the trash in the same folder structure.
 * If the trash already contains a folder with this name, a base-36 encoded timestamp is appended.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response, status 204 if successful.
 */
async function trashFolder(context, info) {
  const bucket = HelixStorage.fromContext(context).sourceBus();

  const destDir = `/.trash/${info.rawPath.split('/').at(-2)}`;

  // Ensure that there is no folder in the trash with this name yet
  const listResp = await bucket.list(`${getS3Key(info.org, info.site, destDir)}/`, { shallow: true });
  const destPath = listResp.length > 0 ? `${destDir}-${Date.now().toString(36)}/` : `${destDir}/`;

  const srcKey = getS3Key(info.org, info.site, info.rawPath);
  const newInfo = RequestInfo.clone(info, { path: destPath });
  const copyOpts = (sKey) => ({ addMetadata: { 'doc-path': getDocPathFromS3Key(sKey) } });

  try {
    const resp = await copyFolder(context, srcKey, newInfo, true, copyOpts, { collision: 'unique' });
    if (resp.length > 0) {
      return new Response('', { status: 204 });
    }
    throw new StatusCodeError('Trashing of folder failed', 500);
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}

/**
 * Delete from the source bus, which means moving it to the trash. Both
 * documents and folders are supported. The trashed documents gets an extra
 * metadata field 'doc-path' which is the path where it was deleted from.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response, status 204 if successful.
 */
export async function deleteSource(context, info) {
  if (info.rawPath.endsWith('/')) {
    return trashFolder(context, info);
  }

  // Trash a document.
  const docName = info.rawPath.split('/').pop();
  const srcKey = getS3KeyFromInfo(info);
  const newInfo = RequestInfo.clone(info, { path: `/.trash/${docName}` });
  const copyOpts = {
    addMetadata: {
      'doc-path': info.resourcePath,
    },
  };

  try {
    const resp = await copyDocument(context, srcKey, newInfo, true, copyOpts, { collision: 'unique' });
    if (resp.length !== 1) {
      throw new StatusCodeError('Trashing of document failed', 500);
    }
    return new Response('', { status: 204 });
  } catch (e) {
    const opts = { e, log: context.log };
    opts.status = e.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
