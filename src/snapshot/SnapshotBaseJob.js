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
/* eslint-disable no-await-in-loop */

import processQueue from '@adobe/helix-shared-process-queue';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { Job } from '../job/Job.js';
import purge, { PURGE_PREVIEW } from '../cache/purge.js';
import { Manifest } from './Manifest.js';
import { SnapshotResource } from './SnapshotResource.js';
import { toWebPath, toResourcePath } from '../support/RequestInfo.js';
import { publishBulkResourceNotification } from '../support/notifications.js';

/**
 * Number of resources to process in parallel within each batch.
 * @type {number}
 */
export const JOB_CONCURRENCY = 50;

/**
 * Common base class for snapshot bulk jobs (add and remove).
 * Subclasses must override:
 * - `get notificationOp()` — the notification operation name
 * - `getSourceRoot(manifest)` — the S3 root for `prepare()`
 * - `processResource(resource)` — per-resource logic
 * - `isSuccess(status)` — whether a resource status counts as successful for notifications
 */
export class SnapshotBaseJob extends Job {
  /**
   * Prepare the bulk operation by resolving paths into individual resources.
   * For prefix entries, lists S3 objects under the prefix. For single paths,
   * checks existence via HEAD.
   *
   * @param {Array<{prefix?: string, path?: string}>} paths processed paths
   * @param {string} root S3 root to list/head against
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket bucket
   * @returns {Promise<SnapshotResource[]>} resources to process
   */
  async prepare(paths, root, bucket) {
    const { ctx } = this;

    /** @type {SnapshotResource[]} */
    const resources = [];

    const excluded = (path) => path.startsWith('/.helix/')
      || path.startsWith('/.snapshots/');

    for (const { prefix, path: webPath } of paths) {
      if (prefix) {
        const items = await bucket.list(`${root}${prefix}`);
        items
          .filter((item) => !item.key.endsWith('/'))
          .forEach((item) => {
            const itemPath = item.key.substring(root.length);
            if (!excluded(itemPath)) {
              const r = new SnapshotResource(itemPath, toWebPath(itemPath));
              r.setLastModified(item.lastModified);
              resources.push(r);
            }
          });
      } else if (!excluded(webPath)) {
        const resourcePath = toResourcePath(webPath);
        const key = `${root}${resourcePath}`;
        const resource = new SnapshotResource(resourcePath, webPath);

        try {
          const { LastModified: lastModified } = await bucket.head(key) ?? {};
          if (lastModified) {
            resource.setLastModified(lastModified);
          } else {
            resource.setStatus(404);
          }
          /* c8 ignore next 3 */
        } catch (e) {
          ctx.log.warn(`unable to get lastModified for ${resourcePath}: ${e.message}`);
        }
        resources.push(resource);
      }
    }

    return resources;
  }

  /**
   * Execute the batch: process resources in chunks, purge cache after each chunk,
   * and send notifications.
   *
   * @param {Manifest} manifest snapshot manifest
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket content bus bucket
   */
  async executeBatch(manifest, bucket) {
    const { ctx, info } = this;

    const toProcess = Array.from(this.state.data.resources);
    while (toProcess.length) {
      if (await this.checkStopped()) {
        break;
      }

      /** @type {SnapshotResource[]} */
      const processed = [];
      await processQueue(toProcess.splice(0, JOB_CONCURRENCY), async (resource) => {
        await this.processResource(resource, manifest, bucket);
        await this.writeStateLazy();
        processed.push(resource);
      }, JOB_CONCURRENCY);

      // purge batch
      if (manifest.resourcesNeedPurge) {
        await purge.content(ctx, info, manifest.resourcesToPurge, PURGE_PREVIEW);
        manifest.markResourcesPurged();
      }

      // send notification
      const successfulPaths = processed
        .filter((r) => this.isSuccess(r.status))
        .map((r) => r.resourcePath);
      this.setProperties({
        resources: processed.map((r) => ({ path: r.webPath, status: r.status })),
      });
      await publishBulkResourceNotification(
        ctx,
        this.notificationOp,
        info,
        successfulPaths,
        [...processed],
        ({ status }) => !this.isSuccess(status),
      );
    }
  }

  // --- hooks for subclasses ---

  /**
   * Notification operation name.
   * @returns {string}
   */
  // eslint-disable-next-line class-methods-use-this
  get notificationOp() {
    throw new Error('subclass must override notificationOp');
  }

  /**
   * Returns the S3 root path for the prepare phase.
   * @param {Manifest} manifest
   * @returns {string}
   */
  // eslint-disable-next-line class-methods-use-this,no-unused-vars
  getSourceRoot(manifest) {
    throw new Error('subclass must override getSourceRoot');
  }

  /**
   * Whether a resource status counts as successful for notifications.
   * @param {number} status
   * @returns {boolean}
   */
  // eslint-disable-next-line class-methods-use-this,no-unused-vars
  isSuccess(status) {
    return status >= 200 && status < 300;
  }

  /**
   * Process a single resource. Must be overridden by subclasses.
   * @param {SnapshotResource} resource
   * @param {Manifest} manifest
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line class-methods-use-this,no-unused-vars
  async processResource(resource, manifest, bucket) {
    throw new Error('subclass must override processResource');
  }

  /**
   * Runs the job: prepare → execute → finalize.
   * @returns {Promise<void>}
   */
  async run() {
    const { ctx, info } = this;
    const { data, data: { snapshotId, paths } } = this.state;

    const bucket = HelixStorage.fromContext(ctx).contentBus();
    const manifest = await Manifest.fromContext(ctx, snapshotId);
    const root = this.getSourceRoot(manifest);

    if (!data.phase) {
      await this.setPhase('prepare');
      data.resources = await this.prepare(paths, root, bucket);
      await this.trackProgress({
        total: data.resources.length,
      });
      await this.setPhase('perform');
    } else {
      // hydrate plain objects back into SnapshotResource instances when resuming
      data.resources = SnapshotResource.fromJSONArray(data.resources);
    }

    if (data.phase === 'perform') {
      try {
        await this.executeBatch(manifest, bucket);
      } finally {
        const needsPurge = await manifest.store(bucket);
        if (needsPurge) {
          await purge.content(ctx, info, [`/.snapshots/${manifest.id}/.manifest.json`], PURGE_PREVIEW);
        }
      }
      await this.setPhase('completed');
    }
  }
}
