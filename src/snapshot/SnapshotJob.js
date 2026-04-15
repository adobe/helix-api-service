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

import { updateSnapshot } from '../contentbus/snapshot.js';
import { Manifest } from './Manifest.js';
import { RequestInfo } from '../support/RequestInfo.js';
import { SnapshotBaseJob } from './SnapshotBaseJob.js';

/**
 * Job that snapshots a bulk of resources in the background.
 */
export class SnapshotJob extends SnapshotBaseJob {
  // eslint-disable-next-line class-methods-use-this
  get notificationOp() { return 'resources-snapshot'; }

  // 404 resources (source missing) are still considered successful:
  // they get recorded in the manifest as "marked for deletion on publish"
  // eslint-disable-next-line class-methods-use-this
  isSuccess(status) {
    return (status >= 200 && status < 300) || status === Manifest.STATUS_DELETED;
  }

  // eslint-disable-next-line class-methods-use-this
  getSourceRoot(contentBusId, manifest) {
    return `${contentBusId}/${manifest.fromLive ? 'live' : 'preview'}`;
  }

  /**
   * Return a flag indicating whether a resource is considered modified.
   *
   * @param {string} contentBusId content bus id
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket
   * @param {import('./SnapshotResource').SnapshotResource} resource resource
   * @returns {Promise<boolean>} true if preview is not modified, else false
   */
  async isModified(contentBusId, bucket, resource) {
    /* c8 ignore next 3 */
    if (!resource.lastModified) {
      return true;
    }

    const { ctx: { log } } = this;
    const { snapshotId } = this.state.data;
    try {
      const key = `${contentBusId}/preview/.snapshots/${snapshotId}${resource.resourcePath}`;
      const { LastModified: lastModified } = await bucket.head(key) ?? {};
      if (!lastModified) {
        return true;
      }

      return Date.parse(lastModified) < resource.lastModified?.getTime();
    /* c8 ignore next 4 */
    } catch (e) {
      log.warn(`unable to get lastModified for ${resource.resourcePath}: ${e.message}`);
      return true;
    }
  }

  /**
   * Process a single resource by copying it into the snapshot.
   *
   * @param {import('./SnapshotResource').SnapshotResource} resource resource
   * @param {Manifest} manifest snapshot manifest
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket content bus bucket
   * @returns {Promise<void>}
   */
  async processResource(resource, manifest, bucket) {
    const { ctx, state: { data: { snapshotId, forceUpdate } } } = this;
    const { contentBusId, log } = ctx;
    const { webPath, resourcePath } = resource;
    this.state.progress.processed += 1;

    const existingStatus = manifest.getResourceStatus(webPath);
    if (!forceUpdate
      && resource.status !== 404 // source exists (not a 404 from prepare)
      && existingStatus === Manifest.STATUS_EXISTS // already in snapshot as existing
      && !await this.isModified(contentBusId, bucket, resource)
    ) {
      log.info(`ignored snapshot update for not modified: ${snapshotId} ${resourcePath}`);
      resource.setStatus(304);
      return;
    }

    log.info(`updating snapshot in content-bus for: ${snapshotId} ${resourcePath}`);
    const localInfo = RequestInfo.clone(this.info, { path: webPath });
    const response = await updateSnapshot(ctx, localInfo);
    // keep 404, even if updating the snapshot returned something else (eg 204)
    const effectiveStatus = response.ok && resource.status === 404
      ? 404
      : response.status;
    resource.setStatus(effectiveStatus);

    if (!response.ok) {
      resource.setStatus(response.status, response.headers.get('x-error'));
      log.warn(`unable to snapshot ${webPath}: (${response.status}) ${resource.error}`);
      this.state.progress.failed += 1;
    }
  }
}
