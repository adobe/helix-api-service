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
import bulkPublish from '../live/bulk-publish.js';
import bulkUnpublish from '../live/bulk-unpublish.js';
import { liveUpdate } from '../live/publish.js';
import unpublish from '../live/unpublish.js';
import purge, { PURGE_LIVE } from '../cache/purge.js';

/**
 * Publishes snapshot resources to live (direct, no review required).
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} snapshotId snapshot id
 * @param {string} rawPath raw path within the snapshot
 * @param {import('./manifest').Manifest} manifest snapshot manifest
 * @returns {Promise<Response>} response
 */
export async function snapshotPublish(context, info, snapshotId, rawPath, manifest) {
  context.attributes.authInfo.assertPermissions('live:write');

  /** @type {Response} */
  let res;

  if (rawPath === '' || rawPath.endsWith('/*')) {
    // bulk publish all resources in manifest
    let resources = [...manifest.resources.values()];
    if (rawPath.endsWith('/*')) {
      // "resolve" path glob, filter resources
      const globRoot = rawPath.slice(0, -2);
      resources = resources.filter((p) => p.path.startsWith(globRoot));
    }
    // nothing to do
    if (!resources.length) {
      return new Response('', { status: 404 });
    }

    // pick the 200s and publish
    const publishPaths = resources.map((r) => r.status !== 404 && r.path).filter(Boolean);
    if (publishPaths.length) {
      context.data.paths = publishPaths;
      context.data.snapshotId = snapshotId;
      res = await bulkPublish(context, info);
    }

    // then remove all 404s
    const removePaths = resources.map((r) => r.status === 404 && r.path).filter(Boolean);
    if (removePaths.length) {
      context.data.paths = removePaths;
      res = await bulkUnpublish(context, info);
    }
  } else {
    // publish or remove resource by path
    if (!manifest.resources.has(rawPath)) {
      return new Response('', { status: 404 });
    }

    const resource = manifest.resources.get(rawPath);
    if (resource.status === 404) {
      // remove
      context.data.paths = [rawPath];
      res = await unpublish(context, info);
      if (res.ok) {
        await purge.content(context, info, [rawPath], PURGE_LIVE);
      }
    } else {
      // publish
      context.data.paths = [rawPath];
      context.data.snapshotId = snapshotId;
      res = await liveUpdate(context, info);
    }
  }

  return res;
}
