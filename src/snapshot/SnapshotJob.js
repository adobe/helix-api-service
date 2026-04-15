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
import { updateSnapshot } from '../contentbus/snapshot.js';
import purge, { PURGE_PREVIEW } from '../cache/purge.js';
import { Manifest } from './Manifest.js';
import { RequestInfo, toWebPath, toResourcePath } from '../support/RequestInfo.js';
import { publishBulkResourceNotification } from '../support/notifications.js';

export const JOB_CONCURRENCY = 50;

/**
 * @typedef Resource
 * @property {Date} lastModified last modified date
 * @property {string} resourcePath resource path
 * @property {string} webPath web path
 * @property {number} status status of update
 * @property {string} error error on update
 */

/**
 * Job that snapshots a bulk of resources in the background.
 */
export class SnapshotJob extends Job {
  /**
   * Prepare the bulk operation by gathering all paths in the relevant partition.
   *
   * @param {Array<{prefix?: string, path?: string}>} paths processed paths
   * @param {string} contentBusId content bus ID
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket bucket
   * @returns {Promise<Resource[]>} resources to snapshot
   */
  async prepare(paths, contentBusId, bucket) {
    const { ctx } = this;
    const { snapshotId } = this.state.data;
    const manifest = await Manifest.fromContext(ctx, snapshotId);
    const { fromLive } = manifest;
    const partition = `${contentBusId}/${fromLive ? 'live' : 'preview'}`;

    /** @type {Resource[]} */
    const resources = [];

    const excluded = (path) => path.startsWith('/.helix/')
      || path.startsWith('/.snapshots/');

    for (const { prefix, path: webPath } of paths) {
      if (prefix) {
        // wildcard: list all resources under the prefix
        // eslint-disable-next-line no-await-in-loop
        const items = await bucket.list(`${partition}${prefix}`);
        items
          .filter((item) => !item.key.endsWith('/'))
          .forEach((item) => {
            const itemPath = item.key.substring(partition.length);
            if (!excluded(itemPath)) {
              resources.push({
                resourcePath: itemPath,
                webPath: toWebPath(itemPath),
                lastModified: item.lastModified,
              });
            }
          });
      } else if (!excluded(webPath)) {
        const resourcePath = toResourcePath(webPath);
        const key = `${partition}${resourcePath}`;
        const resource = { resourcePath, webPath };

        try {
          // eslint-disable-next-line no-await-in-loop
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
    }

    return resources;
  }

  /**
   * Return a flag indicating whether a resource is considered modified.
   *
   * @param {string} contentBusId content bus id
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket
   * @param {Resource} resource resource
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
   * Process a single resource that should be snapshot.
   *
   * @param {Resource} resource resource
   * @param {boolean} forceUpdate force update flag
   * @param {string} contentBusId content bus id
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket
   * @returns {Promise<void>}
   */
  async processResource(resource, forceUpdate, contentBusId, bucket) {
    const { ctx, state: { data: { snapshotId } } } = this;
    const { log } = ctx;
    const { webPath, resourcePath } = resource;
    this.state.progress.processed += 1;

    const manifest = await Manifest.fromContext(ctx, snapshotId);

    if (!forceUpdate
      && resource.status !== 404 // not a 404 now
      && manifest.resources.has(webPath) // already exists
      && manifest.resources.get(webPath).status !== 404 // wasn't a 404 before
      && !await this.isModified(contentBusId, bucket, resource)
    ) {
      log.info(`ignored snapshot update for not modified: ${snapshotId} ${resourcePath}`);
      // eslint-disable-next-line no-param-reassign
      resource.status = 304;
      return;
    }

    log.info(`updating snapshot in content-bus for: ${snapshotId} ${resourcePath}`);
    const localInfo = RequestInfo.clone(this.info, { path: webPath });
    const response = await updateSnapshot(ctx, localInfo);
    // eslint-disable-next-line no-param-reassign
    resource.status = response.ok && resource.status === 404 ? 404 : response.status;

    if (!response.ok) {
      const error = response.headers.get('x-error');
      log.warn(`unable to snapshot ${webPath}: (${response.status}) ${error}`);
      // eslint-disable-next-line no-param-reassign
      resource.error = error;
      this.state.progress.failed += 1;
    }
  }

  /**
   * Snapshot all resources: process in batches, purge cache, and send notifications.
   *
   * @param {string} contentBusId content bus id
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket content bus bucket
   * @param {Manifest} manifest snapshot manifest
   */
  async snapshot(contentBusId, bucket, manifest) {
    const { ctx, info, state: { data: { forceUpdate } } } = this;

    const toProcess = Array.from(this.state.data.resources);
    while (toProcess.length) {
      if (await this.checkStopped()) {
        break;
      }

      /** @type {Resource[]} */
      const processed = [];
      await processQueue(toProcess.splice(0, JOB_CONCURRENCY), async (resource) => {
        await this.processResource(resource, forceUpdate, contentBusId, bucket);
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
        if (resource.status < 300 || resource.status === 404) {
          successfulPaths.push(resource.resourcePath);
        }
      });
      this.setProperties({
        resources: processed.map(
          (r) => ({ path: r.webPath, status: r.status }),
        ),
      });
      await publishBulkResourceNotification(
        ctx,
        'resources-snapshot',
        info,
        successfulPaths,
        [...processed],
        ({ status }) => status !== 404 && !(status >= 200 && status < 300),
      );
    }
  }

  /**
   * Runs the snapshot job.
   * @returns {Promise<void>}
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
      await this.setPhase('snapshot');
    }

    if (this.state.data.phase === 'snapshot') {
      try {
        await this.snapshot(contentBusId, bucket, manifest);
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
