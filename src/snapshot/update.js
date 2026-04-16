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
import { propagateStatusCode } from '@adobe/helix-shared-utils';
import { updateSnapshot } from '../contentbus/snapshot.js';
import { snapshotStatus } from './status.js';
import { Manifest } from './Manifest.js';
import purge, { PURGE_PREVIEW } from '../cache/purge.js';
import { getNotifier } from '../support/notifications.js';
import { createErrorResponse } from '../contentbus/utils.js';

/**
 * Updates manifest properties: lock state, title, description, metadata.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
async function updateManifestProperties(context, info) {
  const { snapshotId } = info;
  const manifest = await Manifest.fromContext(context, snapshotId);

  if ('locked' in context.data) {
    const locked = String(context.data.locked);
    if (locked !== 'true' && locked !== 'false') {
      return createErrorResponse({ log: context.log, status: 400, msg: 'invalid locked value' });
    }

    const lock = locked === 'true';
    if (lock) {
      context.attributes.authInfo.assertPermissions('preview:write');
    } else {
      context.attributes.authInfo.assertPermissions('live:write');
    }
    const changed = manifest.lock(lock);
    if (changed && !context.data?.disableNotifications) {
      await getNotifier(context).publish(`snapshot-${lock ? '' : 'un'}locked`, info, {
        snapshotId,
      });
    }
  }

  for (const prop of Manifest.CUSTOM_PROPERTIES) {
    if (prop in context.data) {
      try {
        manifest.setProperty(prop, context.data[prop]);
      } catch (e) {
        return new Response('', {
          status: 400,
          headers: { 'x-error': e.message },
        });
      }
    }
  }

  return manifest.toResponse(info);
}

/**
 * Adds a single resource to the snapshot by copying it from the source partition.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
async function addResource(context, info) {
  const { log } = context;
  const { snapshotId } = info;

  log.info('updating snapshot in content-bus.');
  const response = await updateSnapshot(context, info);
  let { status } = response;
  if (!response.ok) {
    if (status === 404 || status === 409) {
      return response;
    }
    status = propagateStatusCode(status);
    const msg = response.headers.get('x-error');
    return createErrorResponse({ log: context.log, status, msg });
  }

  const manifest = await Manifest.fromContext(context, snapshotId);
  if (manifest.resourcesNeedPurge) {
    await purge.content(context, info, manifest.resourcesToPurge, PURGE_PREVIEW);
    manifest.markResourcesPurged();
  }

  // bulk resources added (204) — nothing more to return
  if (status === 204) {
    return response;
  }
  // single resource changed — respond with its status
  return snapshotStatus(context, info);
}

/**
 * Updates a snapshot: either manifest properties (no path) or adds a resource (with path).
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function snapshotUpdate(context, info) {
  if (!info.webPath) {
    return updateManifestProperties(context, info);
  }
  return addResource(context, info);
}
