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
import { removeSnapshot } from '../contentbus/snapshot.js';
import { Manifest } from './Manifest.js';
import purge, { PURGE_PREVIEW } from '../cache/purge.js';

/**
 * Removes a resource from a snapshot.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function snapshotRemove(context, info) {
  const { log } = context;
  const { snapshotId } = info;
  const response = await removeSnapshot(context, info);

  if (!response.ok) {
    if (response.status === 404 || response.status === 409) {
      return response;
    }

    const err = response.headers.get('x-error');
    log.error(`error from content bus: ${response.status} ${err}`);
    return new Response('error from content-bus', {
      status: 502,
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
  return response;
}
