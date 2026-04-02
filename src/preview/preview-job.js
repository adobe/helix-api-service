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
import { computeSurrogateKey } from '@adobe/helix-shared-utils';
import { getContentSourceHandler } from '../contentproxy/index.js';
import { Job } from '../job/job.js';
import update from '../contentbus/update.js';
import { updateRedirect, updateRedirects } from '../redirects/update.js';
import purge, { PURGE_PREVIEW, getPurgePathVariants } from '../cache/purge.js';
import { sleep } from '../support/utils.js';
import { publishBulkResourceNotification } from '../support/notifications.js';
import { getMetadataPaths, REDIRECTS_JSON_PATH, PURGE_ALL_CONTENT_THRESHOLD } from '../contentbus/contentbus.js';
import { RequestInfo } from '../support/RequestInfo.js';
import { PreviewResource } from './PreviewResource.js';

/**
 * Concurrency to use when previewing pages.
 */
const DOCBASED_RATE_LIMIT = {
  maxConcurrent: 4,
  limit: 1000,
  interval: 1000, // 1000/sec (disabled for now)
};

/**
 * Rate limits for BYOM content sources in the preview job.
 */
const BYOM_RATE_LIMIT = {
  maxConcurrent: 100,
  limit: 600,
  interval: 1000 * 60, // 1 minute
};

async function isNotModified(context, file) {
  const storage = HelixStorage.fromContext(context).contentBus();
  const { contentBusId } = context;
  const key = `${contentBusId}/preview${file.resourcePath}`;
  const head = await storage.head(key);
  if (!head?.LastModified) {
    return false;
  }
  return Date.parse(head.LastModified) >= file.source.lastModified;
}

/**
 * Job that previews a bulk of resources in the background.
 */
export class PreviewJob extends Job {
  static TOPIC = 'preview';

  /**
   * Collect the resources from onedrive
   *
   * @param {string[]} paths paths to collect
   * @param {object} overlay overlay config
   * @return {Promise<void>}
   */
  async collect(paths, overlay) {
    const { ctx, info, state: { data } } = this;

    const source = overlay ?? ctx.config.content.source;
    const handler = getContentSourceHandler(source);

    const progress = async (stat) => {
      if (await this.checkStopped()) {
        return false;
      }
      await this.trackProgress(stat);
      return true;
    };

    const list = await handler.list(ctx, info, paths, progress);

    const resources = [];
    for (const file of list) {
      const resource = PreviewResource.fromJSON(file);
      if (resource.resourcePath === REDIRECTS_JSON_PATH) {
        // ensure redirects are processed first
        resource.redirects = true;
        resources.unshift(resource);
      } else {
        resources.push(resource);
      }
    }

    // If we are overlaying, append the resources to data.resources
    data.resources = overlay
      ? [...data.resources, ...resources]
      : resources;

    const notFound = resources.filter(({ status }) => status === 404).length;
    await this.trackProgress({
      total: data.resources.length,
      notmodified: 0,
      success: 0,
      failed: notFound,
      processed: notFound,
    });
  }

  /**
   * Process a single file that should be previewed.
   *
   * @param {PreviewResource} file file
   * @param {boolean} forceUpdate whether to force an update
   * @param {import('@adobe/helix-shared-process-queue').Token} token the task token
   */
  async processFile(file, forceUpdate, token) {
    const { ctx, info, state } = this;
    const { log } = ctx;

    if (!forceUpdate && await isNotModified(ctx, file)) {
      log.info(`ignored preview update for not modified ${file.path}`);
      file.setStatus(304);
      state.progress.notmodified += 1;
      token.release();
      return;
    }

    log.info(`updating preview in content-bus for ${file.path}`);
    const start = Date.now();
    const localInfo = RequestInfo.clone(info, { path: file.path, route: 'preview' });

    // special handling for redirects
    let oldRedirects;
    if (file.redirects) {
      oldRedirects = await ctx.getRedirects('preview');
      delete ctx.attributes.redirects;
    }

    let response;
    let retry;
    do {
      retry = 0;
      // eslint-disable-next-line no-await-in-loop
      response = await update(ctx, localInfo);
      if (response.status === 429) {
        // we run the queue with a concurrency of 1, so we don't need to do a group sleep.
        retry = Number.parseInt(response.headers.get('retry-after'), 10) || 1;
        log.info(`rate limit exceeded. sleeping for ${retry}s`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(retry * 1000);
      }
    } while (retry);

    if (oldRedirects && response.ok) {
      // if we processed the redirects, update the resources
      const newRedirects = await ctx.getRedirects('preview');
      const updated = await updateRedirects(ctx, 'preview', oldRedirects, newRedirects);
      if (this.state.data.resources.length <= PURGE_ALL_CONTENT_THRESHOLD) {
        await purge.redirects(ctx, info, updated, PURGE_PREVIEW);
      }
    }

    // check if redirect overwrites the content
    const sourceRedirectLocation = await updateRedirect(ctx, localInfo);

    let { status } = response;
    /* c8 ignore next 9 */ // TODO!
    if (!response.ok) {
      // handle redirects
      if (status === 404) {
        // tweak status if existing redirect
        if (sourceRedirectLocation) {
          status = 200;
        }
      }
    }
    file.setStatus(status);
    const err = response.headers.get('x-error');
    /* c8 ignore next 5 */ // TODO!
    if (err) {
      file.setError(err, response.headers.get('x-error-code') || undefined);
      log.warn(`error from content bus: ${response.status} ${err}`);
      state.progress.failed += 1;
    }

    const stop = Date.now();
    await this.audit(ctx, localInfo, { res: response, start, stop });
  }

  /**
   * Checks if the previewed resources contains config files (currently only metadata)
   * and process them.
   * @returns {Promise<void>}
   */
  async processConfigFiles() {
    if (this.ctx.attributes.config) {
      const paths = getMetadataPaths(this.ctx);
      let metaModified = false;
      for (const resource of this.state.data.resources) {
        if (resource.status === 200 && paths.includes(resource.path)) {
          metaModified = true;
          break;
        }
      }
      if (metaModified) {
        // for helix5, we just purge the config
        await purge.config(this.ctx, this.info);
      }
    }
  }

  /**
   * Gets the rate limit for the preview job.
   * @returns {import('@adobe/helix-shared-process-queue').RateLimitOptions}
   */
  getRateLimit() {
    const { resources } = this.state.data;
    const rateLimit = resources.some(({ source }) => source?.type !== 'markup')
      ? DOCBASED_RATE_LIMIT
      : BYOM_RATE_LIMIT;

    return {
      ...rateLimit,
      abortController: new AbortController(),
    };
  }

  /**
   * preview all the resources
   * @return {Promise<void>}
   */
  async preview() {
    const { state, state: { data: { forceUpdate, resources } } } = this;

    const rateLimit = this.getRateLimit();
    const { abortController } = rateLimit;

    await processQueue([...resources], async (file, queue, results, token) => {
      if (await this.checkStopped()) {
        abortController.abort();
        return;
      }
      if (!file.isProcessed()) {
        await this.processFile(file, forceUpdate, token);
        state.progress.processed += 1;
        if (file.status === 200) {
          state.progress.success += 1;
        }
        await this.writeStateLazy();
      }
    }, rateLimit);

    await this.processConfigFiles();
  }

  /**
   * runs the preview job.
   * @return {Promise<void>}
   */
  async run() {
    const { ctx, info, state: { data } } = this;
    const { contentBusId } = ctx;

    if (data.phase === 'collect') {
      // todo: implement resume for content-source listing
      throw new Error('job cannot be resumed during the collect phase. please provide a smaller input set.');
    }

    // hydrate plain objects from JSON.parse back into PreviewResource instances
    data.resources = PreviewResource.fromJSONArray(data.resources);

    if (!data.phase) {
      await this.setPhase('collect');

      // Start by collecting the paths from the source
      await this.collect(data.paths);

      const unresolvedPaths = data.resources
        .filter(({ status, path }) => status === 404 && !path.endsWith('/*'))
        .map(({ path }) => path);

      // If we have an overlay, attempt to collect the paths that were not found in the first pass
      const overlay = ctx.attributes.config?.content?.overlay;
      if (overlay && unresolvedPaths.length > 0) {
        // Remove the paths that were not found
        data.resources = data.resources.filter(({ status }) => status !== 404);

        await this.collect(unresolvedPaths, overlay);
      }

      await this.setPhase('preview');
    }
    if (data.phase === 'preview') {
      await this.preview();

      const previewedResources = data.resources.filter(({ status }) => status === 200);
      const previewedPaths = previewedResources.map(({ path }) => path);
      const resourcePaths = previewedResources.map(({ resourcePath }) => resourcePath);

      await this.setPhase('purging');
      if (previewedPaths.length > PURGE_ALL_CONTENT_THRESHOLD) {
        // if more than PURGE_ALL_CONTENT_THRESHOLD resources are affected, we purge all content
        await purge.perform(ctx, info, [{ key: `p_${contentBusId}` }], PURGE_PREVIEW, 'main');
      } else {
        const infos = [];
        for (const path of previewedPaths) {
          // eslint-disable-next-line no-await-in-loop
          const variantKeyInfos = await Promise.all(
            getPurgePathVariants(path)
              .map(async (variantPath) => ({ key: `p_${await computeSurrogateKey(`${contentBusId}${variantPath}`)}` })),
          );
          infos.push(...variantKeyInfos);
        }
        await purge.perform(ctx, info, infos, PURGE_PREVIEW, 'main');
      }

      await publishBulkResourceNotification(ctx, 'resources-previewed', info, resourcePaths, data.resources);

      await this.setPhase('completed');
    }
  }
}
