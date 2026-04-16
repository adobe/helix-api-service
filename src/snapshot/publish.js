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
import { Manifest } from './Manifest.js';
import purge, { PURGE_LIVE } from '../cache/purge.js';

/**
 * Publishes snapshot resources to live (direct, no review required).
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('./Manifest.js').Manifest} manifest snapshot manifest
 * @returns {Promise<Response>} response
 */
export async function snapshotPublish(context, info, manifest) {
  context.attributes.authInfo.assertPermissions('live:write');

  const { webPath } = info;

  /** @type {Response} */
  let res;

  if (!webPath || webPath.endsWith('/*')) {
    // bulk publish all resources in manifest
    let resources = [...manifest.resources.values()];
    if (webPath?.endsWith('/*')) {
      // "resolve" path glob, filter resources
      const globRoot = webPath.slice(0, -2);
      resources = resources.filter((p) => p.path.startsWith(globRoot));
    }
    // nothing to do
    if (!resources.length) {
      return new Response('', { status: 404 });
    }

    // pick the 200s and publish
    const publishPaths = resources
      .filter((r) => r.status !== Manifest.STATUS_DELETED)
      .map((r) => r.path);
    if (publishPaths.length) {
      context.data.paths = publishPaths;
      res = await bulkPublish(context, info);
    }

    // then remove all 404s
    const removePaths = resources
      .filter((r) => r.status === Manifest.STATUS_DELETED)
      .map((r) => r.path);
    if (removePaths.length) {
      context.data.paths = removePaths;
      res = await bulkUnpublish(context, info);
    }
  } else {
    // publish or remove resource by path
    const resourceStatus = manifest.getResourceStatus(webPath);
    if (!resourceStatus) {
      return new Response('', { status: 404 });
    }

    if (resourceStatus === Manifest.STATUS_DELETED) {
      // remove
      context.data.paths = [webPath];
      res = await unpublish(context, info);
      if (res.ok) {
        await purge.content(context, info, [webPath], PURGE_LIVE);
      }
    } else {
      // publish
      context.data.paths = [webPath];
      res = await liveUpdate(context, info);
    }
  }

  return res;
}
