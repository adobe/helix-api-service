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

import { createErrorResponse } from '../contentbus/utils.js';
import { SnapshotBaseJob } from './SnapshotBaseJob.js';

/**
 * Job that removes a bulk of snapshot resources from a snapshot in the background.
 */
export class SnapshotRemoveJob extends SnapshotBaseJob {
  static TOPIC = 'snapshot-remove';

  // eslint-disable-next-line class-methods-use-this
  get notificationOp() { return 'resources-snapshot-removed'; }

  // eslint-disable-next-line class-methods-use-this
  getSourceRoot(contentBusId, manifest) {
    return `${contentBusId}/preview/.snapshots/${manifest.id}`;
  }

  /**
   * Delete a single resource from snapshot storage and the manifest.
   *
   * @param {import('./SnapshotBaseJob').Resource} resource
   * @param {Manifest} manifest
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket
   * @param {string} contentBusId
   * @returns {Promise<{ok: boolean, status: number}>}
   */
  async remove(resource, manifest, bucket, contentBusId) {
    const {
      ctx: { log },
      state: { data: { snapshotId } },
    } = this;
    const key = `${contentBusId}/preview/.snapshots/${snapshotId}${resource.resourcePath}`;
    const { webPath } = resource;

    try {
      log.info(`snapshot [${snapshotId}]: bulk deleting ${key}`);
      await bucket.remove(key);
      manifest.removeResource(webPath, true);
      manifest.markResourceUpdated();
      return { ok: true, status: 204 };
    /* c8 ignore next 4 */
    } catch (e) {
      log.error(`snapshot [${snapshotId}]: error bulk deleting ${key}: ${e.message}`);
      return createErrorResponse({ e, log });
    }
  }

  /**
   * Process a single resource that should be deleted from the snapshot.
   *
   * @param {import('./SnapshotResource').SnapshotResource} resource
   * @param {Manifest} manifest snapshot manifest
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket content bus bucket
   * @returns {Promise<void>}
   */
  async processResource(resource, manifest, bucket) {
    const { ctx, state: { data: { snapshotId } } } = this;
    const { contentBusId, log } = ctx;
    const { webPath, resourcePath } = resource;
    this.state.progress.processed += 1;

    if (resource.isProcessed()) {
      // already processed in a previous run or 404 in prepare
      if (resource.status === 404 && manifest.getResourceStatus(webPath)) {
        log.warn(`resource ${webPath} not found in content-bus, but still in manifest for snapshot ${snapshotId}`);
        manifest.removeResource(webPath);
        this.state.progress.failed += 1;
      }
      return;
    }

    if (!manifest.getResourceStatus(webPath)) {
      log.warn(`removing orphaned resource ${webPath} from snapshot ${snapshotId}`);
    }

    log.info(`removing snapshot resource in content-bus for: ${snapshotId} ${resourcePath}`);
    const response = await this.remove(resource, manifest, bucket, contentBusId);
    resource.setStatus(response.status);

    if (!response.ok) {
      resource.setStatus(response.status, response.headers.get('x-error'));
      log.warn(`unable to remove snapshot resource ${webPath}: (${response.status}) ${resource.error}`);
      this.state.progress.failed += 1;
    }
  }
}
