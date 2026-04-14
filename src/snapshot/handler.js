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
import { Manifest } from './Manifest.js';
import { errorResponse } from '../support/utils.js';
import purge, { PURGE_PREVIEW } from '../cache/purge.js';

const ALLOWED_METHODS = ['GET', 'POST', 'DELETE'];

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

  const { snapshotId } = info;

  // list snapshots: GET with no snapshotId
  if (info.method === 'GET' && !snapshotId) {
    return listSnapshots(context, info);
  }

  if (!snapshotId) {
    return errorResponse(log, 400, 'invalid path parameters: "snapshotId" is required');
  }

  const manifest = await Manifest.fromContext(context, snapshotId);
  let shouldStore = false;
  try {
    if (info.method === 'GET') {
      return await snapshotStatus(context, info);
    }
    if (info.method === 'POST') {
      if (context.data?.review) {
        const res = await snapshotReview(context, info, manifest);
        shouldStore = res.ok;
        return res;
      }
      if (String(context.data?.publish) === 'true') {
        return await snapshotPublish(context, info, manifest);
      }
      authInfo.assertPermissions('snapshot:write');
      shouldStore = true; // should be true for bulk as well, since the manifest may not exist yet
      if (info.webPath === '/*') {
        const isDelete = String(context.data?.delete) === 'true';
        if (isDelete) {
          return await bulkRemove(context, info);
        }
        return await bulkSnapshot(context, info);
      }
      return await snapshotUpdate(context, info);
    }

    // DELETE
    authInfo.assertPermissions('snapshot:delete');
    if (!manifest.exists) {
      return new Response('', { status: 404 });
    }

    if (!info.webPath) {
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
      const res = await snapshotRemove(context, info);
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
