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
import purge, { PURGE_PREVIEW } from '../cache/purge.js';
import { Job } from '../job/Job.js';
import { toWebPath, toResourcePath } from '../support/RequestInfo.js';
import { publishBulkResourceNotification } from '../support/notifications.js';
import { Manifest } from './Manifest.js';
import { createErrorResponse } from '../contentbus/utils.js';

const JOB_CONCURRENCY = 50;

/**
 * @typedef Resource
 * @property {Date} lastModified last modified date
 * @property {string} resourcePath resource path
 * @property {string} webPath web path
 * @property {number} status status of update
 * @property {string} error error on update
 */

/**
 * Job that removes a bulk of snapshot resources from a snapshot in the background.
 */
export class SnapshotRemoveJob extends Job {
  static TOPIC = 'snapshot-remove';

  /**
   * Prepare the bulk operation by gathering all paths in the snapshot partition.
   *
   * @param {string[]} paths paths to remove
   * @param {string} contentBusId content bus ID
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket bucket
   * @returns {Promise<Resource[]>} resources to remove
   */
  async prepare(paths, contentBusId, bucket) {
    const { ctx, state: { data: { snapshotId } } } = this;

    /** @type {Resource[]} */
    const resources = [];

    const excluded = (path) => path.startsWith('/.helix/')
      || path.startsWith('/.snapshots/');
    await processQueue([...paths], async (webPath) => {
      if (excluded(webPath)) {
        return;
      }

      const resourcePath = toResourcePath(webPath);
      const key = `${contentBusId}/preview/.snapshots/${snapshotId}${resourcePath}`;
      const resource = {
        resourcePath,
        webPath,
      };

      if (key.endsWith('/*')) {
        const keyPrefix = key.slice(0, -1);
        const items = await bucket.list(keyPrefix);
        items.forEach((item) => {
          if (item.key.endsWith('/')) {
            return;
          }

          const itemResourcePath = `${resourcePath.slice(0, -1)}${item.key.substring(keyPrefix.length)}`;
          resources.push({
            resourcePath: itemResourcePath,
            webPath: toWebPath(itemResourcePath),
            lastModified: item.lastModified,
          });
        });
      } else {
        try {
          const { LastModified: lastModified } = await bucket.head(key) ?? {};
          if (lastModified) {
            resource.lastModified = lastModified;
          } else {
            resource.status = 404;
          }
          /* c8 ignore next 3 */
        } catch (e) {
          ctx.log.warn(`unable to get lastModified for ${resourcePath}: ${e.message}`);
        }

        resources.push(resource);
      }
    }, JOB_CONCURRENCY);

    return resources;
  }

  /**
   * @param {Resource} resource
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
    const resourcePath = `${contentBusId}/preview/.snapshots/${snapshotId}${resource.resourcePath}`;
    const { webPath } = resource;

    try {
      log.info(`snapshot [${snapshotId}]: bulk deleting ${resourcePath}`);
      await bucket.remove(resourcePath);
      manifest.removeResource(webPath, true);
      manifest.markResourceUpdated();
      return { ok: true, status: 204 };
    /* c8 ignore next 4 */
    } catch (e) {
      log.error(`snapshot [${snapshotId}]: error bulk deleting ${resourcePath}: ${e.message}`);
      return createErrorResponse({ e, log });
    }
  }

  /**
   * Process a single resource that should be deleted from snapshot.
   *
   * @param {Resource} resource
   * @param {Manifest} manifest
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket
   * @param {string} contentBusId
   */
  async processResource(resource, manifest, bucket, contentBusId) {
    const { ctx, state: { data: { snapshotId } } } = this;
    const { log } = ctx;
    const { webPath, resourcePath } = resource;
    this.state.progress.processed += 1;

    if (resource.status) {
      // already processed in a previous run or 404 in prepare
      if (resource.status === 404) {
        if (manifest.resources.has(webPath)) {
          log.warn(`resource ${webPath} not found in content-bus, but still in manifest for snapshot ${snapshotId}`);
          manifest.removeResource(webPath);
          this.state.progress.failed += 1;
        }
      }
      return;
    }

    if (!manifest.resources.has(webPath)) {
      log.warn(`removing orphaned resource ${webPath} from snapshot ${snapshotId}`);
    }

    log.info(`removing snapshot resource in content-bus for: ${snapshotId} ${resourcePath}`);
    const response = await this.remove(resource, manifest, bucket, contentBusId);
    // eslint-disable-next-line no-param-reassign
    resource.status = response.status;

    if (!response.ok) {
      const error = response.headers.get('x-error');
      log.warn(`unable to remove snapshot resource ${webPath}: (${response.status}) ${error}`);
      // eslint-disable-next-line no-param-reassign
      resource.error = error;
      this.state.progress.failed += 1;
    }
  }

  /**
   * Runs the snapshot remove job.
   *
   * @return {Promise<void>}
   */
  async run() {
    const { ctx, info } = this;
    const { snapshotId, paths } = this.state.data;

    const bucket = HelixStorage.fromContext(ctx).contentBus();
    const { contentBusId } = ctx;
    const manifest = await Manifest.fromContext(ctx, snapshotId);

    if (!this.state.data.phase) {
      await this.setPhase('prepare');
      this.state.data.resources = await this.prepare(paths, contentBusId, bucket);
      await this.trackProgress({
        total: this.state.data.resources.length,
      });
      await this.setPhase('remove');
    }

    if (this.state.data.phase === 'remove') {
      try {
        const toProcess = Array.from(this.state.data.resources);
        while (toProcess.length) {
          if (await this.checkStopped()) {
            break;
          }
          const processed = [];
          await processQueue(toProcess.splice(0, JOB_CONCURRENCY), async (resource) => {
            await this.processResource(resource, manifest, bucket, contentBusId);
            await this.writeStateLazy();
            processed.push(resource);
          }, JOB_CONCURRENCY);

          // purge batch
          if (manifest.resourcesNeedPurge) {
            await purge.content(ctx, info, manifest.resourcesToPurge, PURGE_PREVIEW);
            manifest.markResourcesPurged();
          }

          // send notification
          const successfulPaths = [];
          processed.forEach((resource) => {
            if (resource.status < 300) {
              successfulPaths.push(resource.resourcePath);
            }
          });
          await publishBulkResourceNotification(
            ctx,
            'resources-snapshot-removed',
            info,
            successfulPaths,
            [...processed],
          );
        }
      } finally {
        if (!this.transient) {
          await manifest.store();
          await purge.content(ctx, info, [`/.snapshots/${manifest.id}/.manifest.json`], PURGE_PREVIEW);
        }
      }

      await this.setPhase('completed');
    }
  }
}
