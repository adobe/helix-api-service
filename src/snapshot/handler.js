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
import { snapshotStatus } from './status.js';
import { snapshotUpdate } from './update.js';
import { snapshotRemove } from './remove.js';
import { snapshotPublish } from './publish.js';
import { listSnapshots } from './list.js';
import { snapshotReview } from './review.js';
import { bulkSnapshot } from './bulk-snapshot.js';
import { bulkRemove } from './bulk-remove.js';
import { Manifest } from './manifest.js';
import { errorResponse } from '../support/utils.js';
import purge, { PURGE_PREVIEW } from '../cache/purge.js';

const ALLOWED_METHODS = ['GET', 'POST', 'DELETE'];

/**
 * Parses the snapshot route path into snapshotId and remaining rawPath.
 * The route is `/:org/sites/:site/snapshots/*` where `*` captures e.g. `/mysnap/some/path`.
 *
 * @param {string} webPath the full web path captured by `*`
 * @returns {{ snapshotId: string, rawPath: string }}
 */
function parseSnapshotPath(webPath) {
  if (!webPath || webPath === '/') {
    return { snapshotId: '', rawPath: '' };
  }
  // webPath is e.g. '/mysnap/some/path' or '/mysnap' or '/*'
  const withoutLeading = webPath.startsWith('/') ? webPath.substring(1) : webPath;
  const slashIdx = withoutLeading.indexOf('/');
  if (slashIdx < 0) {
    return { snapshotId: withoutLeading, rawPath: '' };
  }
  return {
    snapshotId: withoutLeading.substring(0, slashIdx),
    rawPath: withoutLeading.substring(slashIdx),
  };
}

/**
 * Handles the /snapshots route.
 *
 * @param {import('../support/AdminContext').AdminContext} context the context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function snapshotHandler(context, info) {
  const { log, attributes: { authInfo } } = context;

  if (ALLOWED_METHODS.indexOf(info.method) < 0) {
    return new Response('method not allowed', {
      status: 405,
    });
  }

  authInfo.assertPermissions('snapshot:read');

  const { snapshotId, rawPath } = parseSnapshotPath(info.webPath);

  // list snapshots: GET with no snapshotId
  if (info.method === 'GET' && !snapshotId) {
    return listSnapshots(context, info);
  }

  if (!snapshotId) {
    return errorResponse(log, 400, 'invalid path parameters: "snapshotId" is required');
  }

  const isBulk = rawPath === '/*' && context.data?.paths;

  const manifest = await Manifest.fromContext(context, snapshotId);
  let shouldStore = false;
  try {
    if (info.method === 'GET') {
      return await snapshotStatus(context, info, snapshotId, rawPath);
    }
    if (info.method === 'POST') {
      if (context.data?.review) {
        const res = await snapshotReview(context, info, snapshotId, manifest);
        shouldStore = res.ok;
        return res;
      }
      if (String(context.data?.publish) === 'true') {
        return await snapshotPublish(context, info, snapshotId, rawPath, manifest);
      }
      authInfo.assertPermissions('snapshot:write');
      shouldStore = true; // should be true for bulk as well, since the manifest may not exist yet
      if (isBulk) {
        const isDelete = String(context.data?.delete) === 'true';
        if (isDelete) {
          return await bulkRemove(context, info, snapshotId);
        }
        return await bulkSnapshot(context, info, snapshotId);
      }
      return await snapshotUpdate(context, info, snapshotId, rawPath);
    }

    // DELETE
    authInfo.assertPermissions('snapshot:delete');
    if (!manifest.exists) {
      return new Response('', { status: 404 });
    }

    if (rawPath === '') {
      // delete entire snapshot, only allowed if empty
      if (manifest.resources.size > 0) {
        return new Response('', {
          status: 400,
          headers: {
            'x-error': 'cannot delete snapshot containing resources',
          },
        });
      }
      await manifest.delete();
      shouldStore = false;
      return new Response('', { status: 204 });
    } else {
      const res = await snapshotRemove(context, info, snapshotId, rawPath);
      shouldStore = res.ok;
      return res;
    }
  } finally {
    if (shouldStore) {
      const needsPurge = await manifest.store();
      if (needsPurge) {
        await purge.content(context, info, [`/.snapshots/${manifest.id}/.manifest.json`], PURGE_PREVIEW);
      }
    }
  }
}
