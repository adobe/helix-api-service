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
import { logLevelForStatusCode, propagateStatusCode } from '@adobe/helix-shared-utils';
import { updateSnapshot } from '../contentbus/snapshot.js';
import { snapshotStatus } from './status.js';
import { Manifest } from './Manifest.js';
import purge, { PURGE_PREVIEW } from '../cache/purge.js';
import { getNotifier } from '../support/notifications.js';

/**
 * Updates a snapshot by copying content from preview (or live) to the snapshot location,
 * or by updating manifest properties.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function snapshotUpdate(context, info) {
  const { log } = context;
  const { snapshotId, webPath } = info;

  if (!webPath) {
    const manifest = await Manifest.fromContext(context, snapshotId);
    if ('locked' in context.data) {
      // boolean from JSON body, string from query params
      if (![true, false, 'true', 'false'].includes(context.data.locked)) {
        return new Response('', {
          status: 400,
          headers: {
            'x-error': 'invalid locked value',
          },
        });
      }

      const lock = String(context.data.locked) === 'true';
      if (lock) {
        // only allow to lock if the user has preview permission
        context.attributes.authInfo.assertPermissions('preview:write');
      } else {
        // only allow to unlock if the user has publish permission
        context.attributes.authInfo.assertPermissions('live:write');
      }
      const changed = manifest.lock(lock);
      if (changed && !context.data?.disableNotifications) {
        await getNotifier(context).publish(`snapshot-${!lock ? 'un' : ''}locked`, info, {
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
            headers: {
              'x-error': e.message,
            },
          });
        }
      }
    }
    return manifest.toResponse(info);
  }

  log.info('updating snapshot in content-bus.');
  const response = await updateSnapshot(context, info);
  let { status } = response;
  if (!response.ok) {
    if (status === 404 || status === 409) {
      return response;
    }

    status = propagateStatusCode(status);
    const level = logLevelForStatusCode(status);

    const err = response.headers.get('x-error');
    log[level](`error from content bus: ${response.status} ${err}`);

    return new Response('error from content-bus', {
      status,
      headers: {
        'x-error': err,
      },
    });
  }

  const manifest = await Manifest.fromContext(context, snapshotId);
  if (manifest.resourcesNeedPurge) {
    await purge.content(context, info, manifest.resourcesToPurge, PURGE_PREVIEW);
    manifest.markResourcesPurged();
  }

  // bulk resources added
  if (status === 204) {
    return response;
  }
  // single resource changed, respond with its status
  return snapshotStatus(context, info);
}
