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
import { createErrorResponse } from './utils.js';
import { Manifest } from '../snapshot/Manifest.js';
import { toWebPath } from '../support/RequestInfo.js';

/**
 * Copies a single resource from the source partition into the snapshot folder and records
 * it in the manifest. The source partition is `preview` by default, or `live` when the
 * manifest has `fromLive` set.
 *
 * Code paths:
 * - Returns 404 if the resource path targets a filtered location (`.helix/`, `helix-env.json`).
 * - Returns 409 if the snapshot is locked.
 * - If the resource path is already inside `/.snapshots/{snapshotId}/`, the resource is
 *   assumed to exist in storage and is simply registered in the manifest (no copy).
 * - If the source resource does **not** exist in the source partition, it is recorded in
 *   the manifest with status 404 (marking it for deletion on publish). If the resource
 *   previously existed in the snapshot, the old copy is removed. Returns 204.
 * - If the source resource **does** exist, it is copied into the snapshot folder and
 *   recorded in the manifest with status 200. Returns 200.
 *
 * Metadata added to each copied resource:
 * - `x-last-modified-by`: authenticated user email or `'anonymous'`
 * - `last-modified` is renamed to `x-last-previewed` (or `x-last-published` when fromLive)
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} 200 (copied), 204 (source missing, recorded as 404),
 *   409 (locked), 404 (filtered path), or 5xx (storage error)
 */
export async function updateSnapshot(context, info) {
  const { contentBusId, log } = context;
  const { snapshotId, resourcePath } = info;
  try {
    const contentStorage = HelixStorage.fromContext(context).contentBus();
    const manifest = await Manifest.fromContext(context, snapshotId);
    const { fromLive } = manifest;
    const previewRoot = `${contentBusId}/preview`;
    const partitionRoot = fromLive ? `${contentBusId}/live` : previewRoot;

    const srcKey = `${partitionRoot}${resourcePath}`;
    const dstKey = `${previewRoot}/.snapshots/${snapshotId}${resourcePath}`;

    // filter out special files not relevant for snapshots
    if (srcKey === `${partitionRoot}/helix-env.json`
      || srcKey.startsWith(`${partitionRoot}/.helix/`)) {
      return new Response('', { status: 404 });
    }
    if (manifest.isLocked) {
      return createErrorResponse({ status: 409, log, msg: 'snapshot is locked' });
    }

    if (srcKey.startsWith(`${partitionRoot}/.snapshots/`)) {
      // resource is already in snapshot folder, just add it to the manifest
      const relPath = resourcePath.substring(`/.snapshots/${snapshotId}`.length);
      manifest.addResource(toWebPath(relPath));
    } else {
      const webPath = toWebPath(resourcePath);
      // check if source resource exists, if not add as 404 to manifest
      if (await contentStorage.head(srcKey) === null) {
        // remove from destination if manifest already exists & resource also exists
        if (manifest.getResourceStatus(webPath) === Manifest.STATUS_EXISTS) {
          await contentStorage.remove(dstKey);
        }
        manifest.addResource(webPath, Manifest.STATUS_DELETED);
        return new Response('', { status: 204 });
      } else {
        await contentStorage.copy(srcKey, dstKey, {
          addMetadata: {
            'x-last-modified-by': context.attributes?.authInfo?.resolveEmail() || 'anonymous',
          },
          renameMetadata: {
            'last-modified': `x-last-${fromLive ? 'published' : 'previewed'}`,
          },
        });
        manifest.addResource(webPath, Manifest.STATUS_EXISTS);
      }
    }

    manifest.markResourceUpdated();
    return new Response('', { status: 200 });
    /* c8 ignore next 3 */
  } catch (e) {
    return createErrorResponse({ e, log });
  }
}

/**
 * Publishes a snapshot content resource by copying the snapshot resource to the live resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function publishSnapshot(context, info) {
  const { contentBusId, log } = context;
  const { snapshotId, resourcePath, webPath } = info;
  try {
    const contentStorage = HelixStorage.fromContext(context).contentBus();
    const manifest = await Manifest.fromContext(context, snapshotId);
    const resourceStatus = manifest.getResourceStatus(webPath);
    if (!resourceStatus) {
      return new Response('', { status: 404 });
    }

    // if resource is 404, remove from destination
    // otherwise copy from snapshot to destination
    const destination = `${contentBusId}/live${resourcePath}`;
    if (resourceStatus === Manifest.STATUS_DELETED) {
      log.info(`snapshot [${snapshotId}]: removing ${destination}`);
      await contentStorage.remove(destination);
    } else {
      log.info(`snapshot [${snapshotId}]: publishing ${destination}`);
      await contentStorage.copy(
        `${contentBusId}/preview/.snapshots/${snapshotId}${resourcePath}`,
        destination,
        {
          addMetadata: {
            'x-last-modified-by': context.attributes?.authInfo?.resolveEmail() || 'anonymous',
          },
        },
      );
    }

    return new Response('', { status: 200 });
  /* c8 ignore next 3 */
  } catch (e) {
    return createErrorResponse({ e, log });
  }
}

/**
 * Removes a single snapshot resource from storage and the manifest.
 *
 * Code paths:
 * - Returns 404 if the manifest does not exist.
 * - Returns 409 if the snapshot is locked.
 * - If the resource is recorded as 404 in the manifest, removes it from the manifest
 *   only (no storage deletion needed). Returns 204.
 * - If the resource does not exist in storage, removes it from the manifest and returns 404.
 * - Otherwise, deletes the resource from storage, removes it from the manifest,
 *   and returns 204.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} 204 (deleted), 404 (not found), 409 (locked),
 *   or 5xx (storage error)
 */
export async function removeSnapshot(context, info) {
  const { contentBusId, log } = context;
  const { snapshotId, resourcePath } = info;
  const contentStorage = HelixStorage.fromContext(context).contentBus();

  const manifest = await Manifest.fromContext(context, snapshotId);
  try {
    if (!manifest.exists) {
      return new Response('', { status: 404 });
    }
    if (manifest.isLocked) {
      return createErrorResponse({ status: 409, log, msg: 'snapshot is locked' });
    }

    const fullPath = `${contentBusId}/preview/.snapshots/${snapshotId}${resourcePath}`;
    const webPath = toWebPath(resourcePath);
    const existingStatus = manifest.getResourceStatus(webPath);
    manifest.removeResource(webPath);

    if (existingStatus === Manifest.STATUS_DELETED) {
      return new Response('', { status: 204 });
    }

    if (await contentStorage.head(fullPath) === null) {
      log.info(`snapshot [${snapshotId}]: no such resource ${fullPath} (existed in manifest: ${!!existingStatus})`);
      return new Response('', { status: 404 });
    }
    log.info(`snapshot [${snapshotId}]: deleting ${fullPath} (existed in manifest: ${!!existingStatus})`);
    await contentStorage.remove(fullPath);

    manifest.markResourceUpdated();
    return new Response('', { status: 204 });
    /* c8 ignore next 3 */
  } catch (e) {
    return createErrorResponse({ e, log });
  }
}
