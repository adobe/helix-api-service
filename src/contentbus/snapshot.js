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
import { Manifest } from '../snapshot/manifest.js';
import { toWebPath } from '../support/RequestInfo.js';

/**
 * Creates a snapshot of the resource addressed by the path and stores it in the
 * snapshot folder of the given snapshotId.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} snapshotId snapshot id
 * @param {string} resourcePath resource path
 * @returns {Promise<Response>} response
 */
export async function snapshot(context, snapshotId, resourcePath) {
  const { contentBusId, log } = context;
  try {
    const contentStorage = HelixStorage.fromContext(context).contentBus();
    const manifest = await Manifest.fromContext(context, snapshotId);
    const { fromLive } = manifest;
    const previewRoot = `${contentBusId}/preview`; // always used as destination partition
    const liveRoot = `${contentBusId}/live`;
    const partitionRoot = fromLive ? liveRoot : previewRoot; // source partition

    const copyOpts = {
      addMetadata: {
        'x-last-modified-by': context.attributes?.authInfo?.resolveEmail() || 'anonymous',
      },
      renameMetadata: {
        'last-modified': `x-last-${fromLive ? 'published' : 'previewed'}`,
      },
    };

    // filter out special files not relevant for snapshots
    let keyFilter = (key) => key !== `${partitionRoot}/helix-env.json` // legacy, might still be in content
      && !key.startsWith(`${partitionRoot}/.helix/`);

    // handle recursive copy
    if (resourcePath.endsWith('/*')) {
      keyFilter = (key) => key !== `${partitionRoot}/helix-env.json`
        && !key.startsWith(`${partitionRoot}/.helix/`)
        && !key.startsWith(`${partitionRoot}/.snapshots/`); // bulk should ignore snapshots dir

      if (manifest.locked) {
        return createErrorResponse({ status: 409, log, msg: 'snapshot is locked' });
      }

      const trimmedPath = resourcePath.substring(0, resourcePath.length - 1);

      const objFilter = (objInfo) => {
        if (!keyFilter(objInfo.key)) {
          return false;
        }
        const relPath = objInfo.key.substring(partitionRoot.length);
        manifest.addResource(toWebPath(relPath));
        return true;
      };

      const srcKey = `${partitionRoot}${trimmedPath}`;
      const dstKey = `${previewRoot}/.snapshots/${snapshotId}${trimmedPath}`;
      await contentStorage.copyDeep(srcKey, dstKey, objFilter, copyOpts);

      manifest.markUpdated();

      return new Response('', { status: 204 });
    }

    const srcKey = `${partitionRoot}${resourcePath}`;
    const dstKey = `${previewRoot}/.snapshots/${snapshotId}${resourcePath}`;
    if (!keyFilter(srcKey)) {
      return new Response('', { status: 404 });
    }
    if (manifest.locked) {
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
        if (manifest.exists && manifest.resources.get(webPath)?.status !== 404) {
          await contentStorage.remove(dstKey);
        }
        manifest.addResource(webPath, 404);
        return new Response('', { status: 204 });
      } else {
        await contentStorage.copy(srcKey, dstKey, copyOpts);
        manifest.addResource(webPath, 200);
      }
    }

    manifest.markUpdated();
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
 * @param {string} snapshotId snapshot id
 * @param {string} resourcePath resource path
 * @returns {Promise<Response>} response
 */
export async function publishSnapshot(context, snapshotId, resourcePath) {
  const { contentBusId, log } = context;
  const webPath = toWebPath(resourcePath);
  try {
    const contentStorage = HelixStorage.fromContext(context).contentBus();
    const manifest = await Manifest.fromContext(context, snapshotId);
    if (!manifest.resources.has(webPath)) {
      return new Response('', { status: 404 });
    }

    // if resource is 404, remove from destination
    // otherwise copy from snapshot to destination
    const destination = `${contentBusId}/live${resourcePath}`;
    if (manifest.resources.get(webPath).status === 404) {
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
 * Removes a snapshot resource or tree.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} snapshotId snapshot id
 * @param {string} resourcePath resource path
 * @returns {Promise<Response>} response
 */
export async function removeSnapshot(context, snapshotId, resourcePath) {
  const { contentBusId, log } = context;
  const contentStorage = HelixStorage.fromContext(context).contentBus();

  const manifest = await Manifest.fromContext(context, snapshotId);
  try {
    if (!manifest.exists) {
      return new Response('', { status: 404 });
    }

    const prefix = `${contentBusId}/preview/.snapshots/${snapshotId}`;
    let fullPath = `${prefix}${resourcePath}`;
    if (fullPath.endsWith('/*')) {
      fullPath = fullPath.substring(0, fullPath.length - 2);
      const keys = (await contentStorage.list(fullPath)).map((inf) => inf.key);
      if (manifest.locked) {
        return createErrorResponse({ status: 409, log, msg: 'snapshot is locked' });
      }

      if (keys.length) {
        log.info(`snapshot [${snapshotId}]: deleting ${keys.length} below ${fullPath}`);

        for (const key of keys) {
          manifest.removeResource(toWebPath(key.substring(prefix.length)));
        }
        await contentStorage.remove(keys);
      } else {
        const orphans = [...manifest.resources.keys()].filter(
          (p) => `${prefix}${p}`.startsWith(fullPath),
        );
        if (orphans.length) {
          log.info(`snapshot [${snapshotId}]: removing ${orphans.length} orphaned resources below ${fullPath}`);
          for (const p of orphans) {
            manifest.removeResource(p);
          }
        } else {
          log.info(`snapshot [${snapshotId}]: no resources below ${fullPath}`);
        }
        return new Response('', { status: 404 });
      }
    } else {
      if (manifest.locked) {
        return createErrorResponse({ status: 409, log, msg: 'snapshot is locked' });
      }

      const webPath = toWebPath(resourcePath);
      const existing = manifest.resources.get(webPath);
      manifest.removeResource(webPath);
      if (existing && existing.status === 404) {
        return new Response('', { status: 204 });
      }

      if (await contentStorage.head(fullPath) === null) {
        log.info(`snapshot [${snapshotId}]: no such resource ${fullPath} (existed in manifest: ${!!existing})`);
        return new Response('', { status: 404 });
      }
      log.info(`snapshot [${snapshotId}]: deleting ${fullPath} (existed in manifest: ${!!existing})`);
      await contentStorage.remove(fullPath);
    }
    manifest.markUpdated();
    return new Response('', {
      status: 204,
    });
    /* c8 ignore next 3 */
  } catch (e) {
    return createErrorResponse({ e, log });
  }
}
