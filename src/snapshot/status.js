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
import { getContentBusInfo } from '../contentbus/contentbus.js';
import { Manifest } from './Manifest.js';
import { RequestInfo, toResourcePath } from '../support/RequestInfo.js';

/**
 * Retrieves the snapshot status or resource status within a snapshot.
 *
 * @param {import('../support/AdminContext').AdminContext} context the context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function snapshotStatus(context, info) {
  const { snapshotId, webPath } = info;
  const manifest = await Manifest.fromContext(context, snapshotId);
  if (!webPath) {
    // serve manifest json
    if (!manifest.exists) {
      return new Response('', {
        status: 404,
        headers: {
          'x-error': 'not found',
        },
      });
    }
    return manifest.toResponse(info);
  }

  // get resource status within snapshot
  const snapshotResourcePath = `/.snapshots/${snapshotId}${toResourcePath(webPath)}`;
  const snapshotInfo = RequestInfo.clone(info, { path: snapshotResourcePath });

  const preview = await getContentBusInfo(context, snapshotInfo, 'preview');

  // return error if not 404
  if (preview.status !== 200 && preview.status !== 404) {
    return new Response('', {
      status: preview.status,
      headers: {
        'x-error': preview.error,
      },
    });
  }

  const resp = {
    webPath,
    resourcePath: snapshotResourcePath,
    preview,
    snapshot: {
      id: snapshotId,
      locked: manifest.locked,
      fromLive: manifest.fromLive,
    },
    links: info.getAPIUrls('status', 'preview', 'live', 'code'),
  };
  resp.links.snapshot = info.getLinkUrl(`/${info.org}/sites/${info.site}/snapshots/${snapshotId}${webPath}`);

  return new Response(JSON.stringify(resp, null, 2), {
    headers: {
      'content-type': 'application/json',
    },
  });
}
