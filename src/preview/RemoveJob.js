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
import processQueue from '@adobe/helix-shared-process-queue';
import { HelixStorage } from '@adobe/helix-shared-storage';

import purge, { PURGE_PREVIEW } from '../cache/purge.js';
import { getMetadataPaths, REDIRECTS_JSON_PATH, PURGE_ALL_CONTENT_THRESHOLD } from '../contentbus/contentbus.js';
import contentbusRemove from '../contentbus/remove.js';
import { Job } from '../job/Job.js';
import { publishBulkResourceNotification } from '../support/Notifications.js';
import { RequestInfo, toWebPath } from '../support/RequestInfo.js';
import { RemoveResource } from './RemoveResource.js';

/**
 * Concurrency to use when deleting previews.
 */
const JOB_CONCURRENCY = 4;

/**
 * Job that deletes a bulk of previews in the background.
 */
export class RemoveJob extends Job {
  /**
   * Topic of this job.
   */
  static TOPIC = 'preview-remove';

  /**
   * Prepare the bulk operation by gathering all paths in the preview partition.
   *
   * @param {Array<import('../support/utils.js').PrefixOrPath>} paths paths to remove
   * @param {string} contentBusId content bus ID
   * @param {HelixStorage} storage storage to use
   * @returns {Promise<Array<Resource>>} resources to delete
   */
  async prepare(paths, contentBusId, storage) {
    const { info, ctx } = this;

    const metadataPaths = getMetadataPaths(ctx);
    const resources = [];

    const excluded = (path) => metadataPaths.includes(path)
      || path.startsWith('/.helix/')
      || path.startsWith('/.snapshots/')
      || path === REDIRECTS_JSON_PATH;

    for (const { prefix, path: webPath } of paths) {
      if (prefix) {
        // eslint-disable-next-line no-await-in-loop
        const entries = await storage.list(`${contentBusId}/preview${prefix}`);
        const mapped = entries
          .map((entry) => ({ ...entry, path: `${prefix}${entry.path}` }))
          .filter(({ path }) => !excluded(path))
          .map(({ lastModified, path }) => new RemoveResource(path, toWebPath(path), lastModified));
        resources.push(...mapped);
      } else if (!excluded(webPath)) {
        const { resourcePath } = RequestInfo.clone(info, { path: webPath });
        const key = `${contentBusId}/preview${resourcePath}`;

        // eslint-disable-next-line no-await-in-loop
        const { LastModified: lastModified } = await storage.head(key) ?? {};
        if (lastModified) {
          resources.push(new RemoveResource(resourcePath, webPath, lastModified));
        }
      }
    }
    return resources;
  }

  /**
   * Process a single resource that should be deleted from preview.
   *
   * @param {RemoveResource} resource resource
   */
  async processResource(resource) {
    const { ctx, ctx: { log }, info } = this;
    const { webPath } = resource;

    const start = Date.now();
    const localInfo = RequestInfo.clone(info, { path: webPath, route: 'preview' });

    const res = await contentbusRemove(ctx, localInfo, 'preview');
    const { status } = res;

    if (!res.ok) {
      const err = res.headers.get('x-error');
      log.warn(`unable to delete preview of ${webPath}: (${res.status}) ${err}`);
      resource.setStatus(status, err);
      return;
    }
    resource.setStatus(status);

    const stop = Date.now();
    await this.audit(ctx, localInfo, { res, start, stop });
  }

  /**
   * Runs the preview delete job.
   *
   * @return {Promise<void>}
   */
  async run() {
    const { ctx, info, state } = this;
    const { contentBusId } = ctx;
    const { data, data: { paths } } = state;

    const storage = HelixStorage.fromContext(ctx).contentBus();

    await this.setPhase('collecting');

    data.resources = await this.prepare(paths, contentBusId, storage);
    await this.trackProgress({
      total: data.resources.length,
    });

    await this.setPhase('deleting');

    await processQueue([...data.resources], async (/** @type {RemoveResource} */ resource) => {
      if (await this.checkStopped()) {
        return;
      }
      await this.processResource(resource);

      state.progress.processed += 1;
      await this.writeStateLazy();
    }, JOB_CONCURRENCY);

    const removedResources = data.resources.filter((r) => r.isDeleted());
    const removedPaths = removedResources.map(({ webPath }) => webPath);
    const resourcePaths = removedResources.map(({ resourcePath }) => resourcePath);

    await this.setPhase('purging');
    if (removedPaths.length > PURGE_ALL_CONTENT_THRESHOLD) {
      await purge.perform(ctx, info, [{ key: `p_${contentBusId}` }], PURGE_PREVIEW, 'main');
    } else {
      await purge.content(ctx, info, removedPaths, PURGE_PREVIEW);
    }

    await publishBulkResourceNotification(ctx, 'resources-unpreviewed', info, resourcePaths, data.resources);

    await this.setPhase('completed');
  }
}
