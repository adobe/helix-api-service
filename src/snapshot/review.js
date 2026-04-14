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

const REVIEW_TENSES = {
  request: 'requested',
  reject: 'rejected',
  approve: 'approved',
};

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

  if (!(review in REVIEW_TENSES)) {
    return new Response('', {
      status: 400,
      headers: {
        'x-error': 'invalid review value',
      },
    });
  }

  if (!manifest.exists) {
    return new Response('', { status: 404 });
  }

  /** @type {Response} */
  let res = new Response('', { status: 204 });

  switch (review) {
    case 'request':
      if (manifest.locked) {
        res = new Response('', {
          status: 409,
          headers: {
            'x-error': 'snapshot already locked',
          },
        });
        break;
      }
      // lock snapshot
      manifest.setReviewState('requested');
      manifest.lock(true);
      break;
    case 'reject':
      if (!manifest.locked) {
        res = new Response('', {
          status: 409,
          headers: {
            'x-error': 'snapshot not locked',
          },
        });
        break;
      }
      // unlock snapshot
      manifest.setReviewState('rejected');
      manifest.lock(false);
      break;
    case 'approve': {
      authInfo.assertPermissions('snapshot:delete', 'live:write');
      if (!manifest.locked) {
        res = new Response('', {
          status: 409,
          headers: {
            'x-error': 'snapshot not locked',
          },
        });
        break;
      } else if (manifest.resources.size === 0) {
        manifest.lock(false);
        manifest.setReviewState(undefined);
        break;
      }

      // publish snapshot resources
      context.data.paths = [...manifest.resources.values()]
        .map((r) => r.status !== 404 && r.path)
        .filter(Boolean);

      res = await bulkPublish(context, info);
      if (!res.ok) {
        res = new Response('', {
          status: res.status,
          headers: {
            'x-error': 'failed to publish snapshot',
          },
        });
        break;
      }

      // remove 404s
      context.data.paths = [...manifest.resources.values()]
        .map((r) => r.status === 404 && r.path)
        .filter(Boolean);
      if (context.data.paths.length) {
        res = await bulkUnpublish(context, info);
        if (!res.ok) {
          res = new Response('', {
            status: res.status,
            headers: {
              'x-error': 'failed to remove snapshot 404s from live',
            },
          });
          break;
        }
      }

      // unlock, optionally clear all resources
      manifest.setReviewState(undefined);
      manifest.lock(false);
      if (!['true', true].includes(keepResources)) {
        const { contentBusId } = context;
        const storage = HelixStorage.fromContext(context).contentBus();
        const prefix = `${contentBusId}/preview/.snapshots/${snapshotId}`;
        const keys = [...manifest.resources.values()]
          .filter((r) => r.status !== 404)
          .map((r) => `${prefix}${toResourcePath(r.path)}`);
        if (keys.length) {
          await storage.remove(keys);
        }
        for (const r of manifest.resources.keys()) {
          manifest.removeResource(r);
        }
      }
      break;
    }
    /* c8 ignore next 2 */
    default:
      break;
  }

  if (res.ok) {
    const op = `review-${REVIEW_TENSES[review]}`;
    await getNotifier(context).publish(op, info, {
      ...(message ? { message } : {}),
      ...(typeof keepResources !== 'undefined' ? { keepResources: ['true', true].includes(keepResources) } : {}),
      snapshotId,
    });
  }

  return res;
}
