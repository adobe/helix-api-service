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
import { computeSurrogateKey } from '@adobe/helix-shared-utils';
import { HelixStorage } from '@adobe/helix-shared-storage';

import purge, { PURGE_LIVE, getPurgePathVariants } from '../cache/purge.js';
import { getMetadataPaths, REDIRECTS_JSON_PATH, PURGE_ALL_CONTENT_THRESHOLD } from '../contentbus/contentbus.js';
import { Job } from '../job/job.js';
import indexUpdate from '../index/update.js';
import { fetchExtendedIndex } from '../index/utils.js';
import { publishBulkResourceNotification } from '../support/notifications.js';
import { RequestInfo } from '../support/RequestInfo.js';
import { hasSimpleSitemap, installSimpleSitemap } from '../sitemap/utils.js';
import { updateRedirects } from '../redirects/update.js';
import { liveUpdate } from './publish.js';

/**
 * Concurrency to use when publishing resources.
 */
const JOB_CONCURRENCY = 50;

/**
 * @typedef Resource
 * @property {Date} [lastModified] last modified date on preview
 * @property {string} resourcePath resource path
 * @property {string} path web path
 * @property {boolean} [metadata] true if this is a metadata resource
 * @property {boolean} [redirects] true if this is the redirects resource
 * @property {boolean} [purged] true once the CDN cache has been purged
 * @property {boolean} [indexed] true once the resource has been indexed
 * @property {boolean} [notified] true once the notification has been sent
 * @property {number} [status] HTTP status of the publish operation
 * @property {string} [error] error message on failure
 */

/**
 * Job that publishes a bulk of resources to live in the background.
 */
export class PublishJob extends Job {
  /**
   * Topic of this job.
   */
  static TOPIC = 'live-publish';

  /**
   * Prepare the bulk operation by gathering resource metadata for each path.
   *
   * @param {string[]} paths web paths to publish
   * @param {string} contentBusId content bus ID
   * @param {HelixStorage} storage storage to use
   */
  async prepare(paths, contentBusId, storage) {
    const { ctx, info } = this;
    const { data, data: { forceUpdate } } = this.state;
    const metadataPaths = getMetadataPaths(ctx);

    const excluded = (path) => path.startsWith('/.helix/') || path.startsWith('/.snapshots/');
    const resources = [];

    await processQueue([...paths], async (path) => {
      if (excluded(path)) {
        return;
      }
      const { resourcePath } = RequestInfo.clone(info, { path, route: 'live' });
      const resource = { resourcePath, path };

      if (!forceUpdate) {
        // check if resource exists on preview partition
        const key = `${contentBusId}/preview${resourcePath}`;
        try {
          const { LastModified: lastModified } = await storage.head(key) ?? {};
          if (lastModified) {
            resource.lastModified = lastModified;
          } else {
            resource.status = 404;
          }
        } catch (e) {
          ctx.log.warn(`unable to get lastModified for ${resourcePath}: ${e.message}`);
        }
      }

      if (metadataPaths.includes(resourcePath)) {
        // metadata resources are processed first
        resource.metadata = true;
        resources.unshift(resource);
      } else if (resourcePath === REDIRECTS_JSON_PATH) {
        resource.redirects = true;
        resources.push(resource);
      } else {
        resources.push(resource);
      }
    }, JOB_CONCURRENCY);

    data.resources = resources;
    await this.trackProgress({
      total: data.resources.length,
      failed: data.resources.filter((r) => r.status === 404).length,
      notmodified: 0,
      success: 0,
    });
  }

  /**
   * Returns whether a resource on preview is newer than the live version.
   *
   * @param {string} contentBusId content bus id
   * @param {HelixStorage} storage content bus storage
   * @param {Resource} resource resource
   * @returns {Promise<boolean>} true if the resource should be published
   */
  // eslint-disable-next-line class-methods-use-this
  async isModified(contentBusId, storage, resource) {
    const { ctx: { log } } = this;
    if (!resource.lastModified) {
      return true;
    }
    try {
      const key = `${contentBusId}/live${resource.resourcePath}`;
      const { LastModified: lastModified } = await storage.head(key) ?? {};
      if (!lastModified) {
        return true;
      }
      return Date.parse(lastModified) < resource.lastModified?.getTime();
    } catch (e) {
      log.warn(`unable to get lastModified for ${resource.resourcePath}: ${e.message}`);
      return true;
    }
  }

  /**
   * Process a single resource by publishing it from preview to live.
   *
   * @param {Resource} resource resource to publish
   * @param {string} contentBusId content bus id
   * @param {HelixStorage} storage content bus storage
   */
  async processResource(resource, contentBusId, storage) {
    const { ctx, ctx: { log }, info } = this;
    const { progress, data: { forceUpdate } } = this.state;
    const { path } = resource;

    if (resource.status) {
      // already determined in prepare (e.g. 404) or processed in a previous run
      return;
    }

    if (!forceUpdate && !await this.isModified(contentBusId, storage, resource)) {
      log.info(`ignored live update for not modified: ${resource.resourcePath}`);
      // eslint-disable-next-line no-param-reassign
      resource.status = 304;
      progress.notmodified += 1;
      return;
    }

    const start = Date.now();
    const localInfo = RequestInfo.clone(info, { path, route: 'live' });

    const res = await liveUpdate(ctx, localInfo);
    const { status } = res;
    // eslint-disable-next-line no-param-reassign
    resource.status = status;

    if (!res.ok) {
      if (status !== 404) {
        const err = res.headers.get('x-error');
        log.warn(`unable to publish ${path}: (${status}) ${err}`);
        // eslint-disable-next-line no-param-reassign
        resource.error = err;
      }
      progress.failed += 1;
      return;
    }

    const stop = Date.now();
    await this.audit(ctx, localInfo, { res, start, stop });
  }

  /**
   * Handle the redirects.json resource, updating redirect rules after publish.
   *
   * @param {Resource} resource the redirects resource
   * @param {string} contentBusId content bus id
   * @param {HelixStorage} storage content bus storage
   */
  async processRedirects(resource, contentBusId, storage) {
    const { ctx, info } = this;

    const oldRedirects = await ctx.getRedirects('live');
    delete ctx.attributes.redirects;

    await this.processResource(resource, contentBusId, storage);

    if (oldRedirects && resource.status === 200) {
      const newRedirects = await ctx.getRedirects('live');
      const updated = await updateRedirects(ctx, 'live', oldRedirects, newRedirects);
      await purge.redirects(ctx, info, updated, PURGE_LIVE);
      // TODO: await removePages(ctx, info, updated);
    }
  }

  /**
   * Index all successfully published resources.
   *
   * @param {import('../support/AdminContext').AdminContext} ctx context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {Array<Resource>} resources resources that were processed
   */
  // eslint-disable-next-line class-methods-use-this
  async indexBatch(ctx, info, resources) {
    // TODO: replace with bulkIndex(ctx, info, toIndex) once available in helix-api-service.
    // For now, index resources one by one using the existing per-resource indexUpdate.
    const toIndex = resources.filter((r) => r.purged && !r.indexed && r.status !== 304);
    await processQueue(toIndex, async (resource) => {
      // eslint-disable-next-line no-param-reassign
      resource.indexed = true;
      const localInfo = RequestInfo.clone(info, { path: resource.path, route: 'live' });
      const index = await fetchExtendedIndex(ctx, localInfo);
      if (index) {
        await indexUpdate(ctx, localInfo, index, { lastPublished: new Date() });
      }
    }, JOB_CONCURRENCY);
  }

  /**
   * Send the bulk notification for all resources that were purged and indexed.
   *
   * @param {import('../support/AdminContext').AdminContext} ctx context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {Array<Resource>} resources resources that were processed
   */
  // eslint-disable-next-line class-methods-use-this
  async notifyBatch(ctx, info, resources) {
    const publishedResourcePaths = [];
    const toNotify = [];
    for (const resource of resources) {
      if (!resource.notified && resource.status !== 304) {
        // eslint-disable-next-line no-param-reassign
        resource.notified = true;
        if (resource.purged && resource.indexed) {
          publishedResourcePaths.push(resource.resourcePath);
        }
        toNotify.push(resource);
      }
    }
    await publishBulkResourceNotification(ctx, 'resources-published', info, publishedResourcePaths, toNotify);
  }

  /**
   * Publish all resources from preview to live.
   *
   * @param {string} contentBusId content bus id
   * @param {HelixStorage} storage content bus storage
   * @returns {Promise<void>}
   */
  async publish(contentBusId, storage) {
    const { ctx, info, state: { data } } = this;

    await installSimpleSitemap(ctx, info, true);

    // process redirects.json first so redirect purging happens before the main batch
    const redirectsResource = data.resources.find((r) => r.redirects);
    if (redirectsResource && !redirectsResource.status) {
      await this.processRedirects(redirectsResource, contentBusId, storage);
      this.state.progress.processed += 1;
      if (redirectsResource.status === 200) {
        this.state.progress.success += 1;
      }
      await this.writeStateLazy();
    }

    await processQueue([...data.resources], async (/** @type {Resource} */ resource) => {
      if (await this.checkStopped()) {
        return;
      }
      if (resource.redirects) {
        return; // already processed above
      }
      await this.processResource(resource, contentBusId, storage);
      this.state.progress.processed += 1;
      if (resource.status === 200) {
        this.state.progress.success += 1;
      }
      await this.writeStateLazy();
    }, JOB_CONCURRENCY);

    if (data.resources.some((r) => r.metadata && r.status === 200)) {
      await purge.config(ctx, info);
      if (await hasSimpleSitemap(ctx, info)) {
        data.needsBulkIndex = true;
      }
    }
  }

  /**
   * Purge the CDN cache for all successfully published resources.
   *
   * @param {string} contentBusId content bus id
   * @returns {Promise<void>}
   */
  async purge(contentBusId) {
    const { ctx, info, state: { data: { resources } } } = this;

    // compute per-resource surrogate keys and perform a single bulk CDN purge
    const infos = [];
    if (resources.length > PURGE_ALL_CONTENT_THRESHOLD) {
      infos.push({ key: contentBusId });
      for (const resource of resources) {
        // eslint-disable-next-line no-param-reassign
        resource.purged = true;
      }
    } else {
      for (const resource of resources) {
        if (!resource.purged && resource.status !== 304) {
          // eslint-disable-next-line no-param-reassign
          resource.purged = true;
          const { path } = resource;
          if (path.endsWith('.json')) {
            // eslint-disable-next-line no-await-in-loop
            infos.push({ key: await computeSurrogateKey(`${contentBusId}${path}`) });
          } else {
            // eslint-disable-next-line no-await-in-loop
            const variantInfos = await Promise.all(
              getPurgePathVariants(path)
                .map(async (variant) => ({ key: await computeSurrogateKey(`${contentBusId}${variant}`) })),
            );
            infos.push(...variantInfos);
          }
        }
      }
    }
    await purge.perform(ctx, info, infos, PURGE_LIVE, 'main');
    await this.writeStateLazy();
  }

  /**
   * Index and notify for all successfully published resources.
   *
   * @returns {Promise<void>}
   */
  async index() {
    const { ctx, info, state: { data } } = this;
    const { resources, needsBulkIndex } = data;

    await this.indexBatch(ctx, info, resources);
    await this.notifyBatch(ctx, info, resources);
    await this.writeStateLazy();

    // re-index simple sitemap if any metadata file was published
    if (needsBulkIndex) {
      // TODO: await bulkIndex(ctx, info, ['/*'], { indexNames: ['#simple'] });
      delete data.needsBulkIndex;
    }
  }

  /**
   * Runs the bulk publish job.
   *
   * @returns {Promise<void>}
   */
  async run() {
    const { ctx } = this;
    const { contentBusId } = ctx;
    const { data, data: { paths } } = this.state;

    const storage = HelixStorage.fromContext(ctx).contentBus();

    if (data.phase === 'prepare') {
      // todo: implement resume for content-source listing
      throw new Error('job cannot be resumed during the prepare phase. please provide a smaller input set.');
    }

    if (!data.phase) {
      await this.setPhase('prepare');
      await this.prepare(paths, contentBusId, storage);
      await this.setPhase('publish');
    }

    if (data.phase === 'publish') {
      await this.publish(contentBusId, storage);
      await this.setPhase('purge');
    }

    if (await this.checkStopped()) {
      return;
    }

    if (data.phase === 'purge') {
      await this.purge(contentBusId);
      await this.setPhase('index');
    }

    if (data.phase === 'index') {
      await this.index();
      await this.setPhase('completed');
    }
  }
}
