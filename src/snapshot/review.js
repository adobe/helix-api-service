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
import bulkPublish from '../live/bulk-publish.js';
import bulkUnpublish from '../live/bulk-unpublish.js';
import { getNotifier } from '../support/notifications.js';
import { toResourcePath } from '../support/RequestInfo.js';
import { Manifest } from './Manifest.js';

function lockStatusError(locking) {
  const msg = locking ? 'snapshot already locked' : 'snapshot is not locked';
  return new Response('', { status: 409, headers: { 'x-error': msg } });
}

/**
 * Publish all snapshot resources to live, then optionally clear them.
 *
 * @param {import('../support/AdminContext').AdminContext} context
 * @param {import('../support/RequestInfo').RequestInfo} info
 * @param {Manifest} manifest
 * @returns {Promise<Response>}
 */
async function publishAndClear(context, info, manifest) {
  const resources = [...manifest.resources.values()];

  // publish existing resources
  const publishPaths = resources
    .filter((r) => r.status !== Manifest.STATUS_DELETED)
    .map((r) => r.path);
  if (publishPaths.length) {
    context.data.paths = publishPaths;
    const res = await bulkPublish(context, info);
    if (!res.ok) {
      return new Response('', {
        status: res.status,
        headers: { 'x-error': 'failed to publish snapshot' },
      });
    }
  }

  // remove deleted resources from live
  const removePaths = resources
    .filter((r) => r.status === Manifest.STATUS_DELETED)
    .map((r) => r.path);
  if (removePaths.length) {
    context.data.paths = removePaths;
    const res = await bulkUnpublish(context, info);
    if (!res.ok) {
      return new Response('', {
        status: res.status,
        headers: { 'x-error': 'failed to remove deleted resources from live' },
      });
    }
  }

  // optionally clear snapshot resources
  if (!['true', true].includes(context.data.keepResources)) {
    const { contentBusId } = context;
    const storage = HelixStorage.fromContext(context).contentBus();
    const prefix = `${contentBusId}/preview/.snapshots/${info.snapshotId}`;
    const keys = publishPaths.map((p) => `${prefix}${toResourcePath(p)}`);
    if (keys.length) {
      await storage.remove(keys);
    }
    for (const r of manifest.resources.keys()) {
      manifest.removeResource(r);
    }
  }

  return new Response('', { status: 204 });
}

/**
 * Handles review workflow for a snapshot: request, approve, reject.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('./Manifest.js').Manifest} manifest snapshot manifest
 * @returns {Promise<Response>} response
 */
export async function snapshotReview(context, info, manifest) {
  const { snapshotId } = info;
  const {
    data: { review, message, keepResources },
    attributes: { authInfo },
  } = context;
  authInfo.assertPermissions('snapshot:write');

  if (!['request', 'reject', 'approve'].includes(review)) {
    return new Response('', {
      status: 400,
      headers: { 'x-error': 'invalid review value' },
    });
  }

  if (!manifest.exists) {
    return new Response('', { status: 404 });
  }

  let res;

  if (review === 'request') {
    if (!manifest.lock(true)) {
      return lockStatusError(true);
    }
    manifest.setReviewState('requested');
    res = new Response('', { status: 204 });
  } else if (review === 'reject') {
    if (!manifest.lock(false)) {
      return lockStatusError(false);
    }
    manifest.setReviewState('rejected');
    res = new Response('', { status: 204 });
  } else {
    // approve
    authInfo.assertPermissions('snapshot:delete', 'live:write');
    if (!manifest.isLocked) {
      return lockStatusError(false);
    }
    if (manifest.resources.size === 0) {
      manifest.lock(false);
      manifest.setReviewState(undefined);
      res = new Response('', { status: 204 });
    } else {
      res = await publishAndClear(context, info, manifest);
      if (res.ok) {
        manifest.setReviewState(undefined);
        manifest.lock(false);
      }
    }
  }

  if (res.ok) {
    await getNotifier(context).publish(`review-${review}d`, info, {
      ...(message ? { message } : {}),
      ...(typeof keepResources !== 'undefined'
        ? { keepResources: ['true', true].includes(keepResources) }
        : {}),
      snapshotId,
    });
  }

  return res;
}
