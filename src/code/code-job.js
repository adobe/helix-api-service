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

import mime from 'mime';
import {
  ModifiersConfig, IndexConfig, SitemapConfig, IgnoreConfig,
} from '@adobe/helix-shared-config';
import processQueue from '@adobe/helix-shared-process-queue';
import { sanitizeName } from '@adobe/helix-shared-string';
import { HelixStorage } from '@adobe/helix-shared-storage';
import tree from './github-tree.js';
import { ALLOWED_HEADERS_FILTER, measure } from '../support/utils.js';
import { Job } from '../job/job.js';
import purge, { PURGE_PREVIEW_AND_LIVE } from '../cache/purge.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import {
  createDeployment,
  fetchContent,
  getCodeSource,
  logGithubRateLimit,
  logGithubErrorResponse,
  updateDeployment, getRefSha,
} from './github-bot.js';
import { fetchHlxJson } from '../config/utils.js';
import { RateLimitError } from './rate-limit-error.js';

/**
 * @typedef CodeJobData
 * @property changes
 * @property {string} ref
 * @property {string} branch
 */

/**
 * @typedef Resource
 * @property {string} resourcePath resource path
 * @property {string|undefined} lastModified last modified date in UTC
 * @property {string|undefined} contentType content type
 * @property {string|undefined} error error
 * @property {boolean|undefined} delete whether resource was deleted
 */

/**
 * @typedef {import('./index').ChangeEvent} ChangeEvent
 */

/**
 * Path of the aggregate config
 * @type {string}
 */
export const CONFIG_PATH = 'helix-config.json';

/**
 * Other configuration files
 */
export const OTHER_CONFIG_FILES = {
  'helix-query.yaml': {
    name: 'query',
    attribute: 'indexConfig',
    Loader: IndexConfig,
  },
  'helix-sitemap.yaml': {
    name: 'sitemap',
    attribute: 'sitemapConfig',
    Loader: SitemapConfig,
  },
};

/**
 * Rate limits for code sync
 * https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28#about-secondary-rate-limits
 */
const RATE_LIMIT = {
  maxConcurrent: 12, // github allows 100, though
  limit: 900, // github allows  900 points
  interval: 1000 * 60, // 1 minute
};

/**
 * Returns the ref (branch) name to use in the codebus for the given github ref.
 * It ensures that the codebus ref is lowercase and does not contain unsupported characters.
 *
 * @param {string} githubRef
 * @returns {string}
 */
export function getCodeRef(githubRef) {
  return githubRef
    ? sanitizeName(githubRef)
    : '';
}

/**
 * check if path contains valid characters as limited by aem.(live|page):
 * @param path
 */
export function isValidPath(path) {
  return /^[/a-zA-Z0-9._-]*$/.test(path);
}

/**
 * Creates a code info response for the given change
 * @param {Change} change
 * @param {number} status
 * @param {string} error
 * @returns {Resource}
 */
function createResourceInfo(change, status = 200, error = null) {
  let ret;
  if (change.type === 'deleted') {
    ret = {
      status,
      resourcePath: `/${change.path}`,
      deleted: true,
    };
  } else {
    ret = {
      status,
      resourcePath: `/${change.path}`,
      lastModified: change.lastModified || new Date().toUTCString(),
      contentType: change.contentType,
    };
  }
  if (error) {
    ret.error = error;
  }
  if (change.contentLength !== undefined) {
    ret.contentLength = change.contentLength;
  }
  return ret;
}

/**
 * Retrieves the hlxignore from github and stores it in the context as IgnoreConfig.
 * If 404 is encountered, returns an empty IgnoreConfig that considers nothing ignored.
 *
 * @param {AdminContext} ctx the context
 * @param {CodeSource} codeSource
 * @param {ChangeEvent} evt
 * @param timer
 * @returns {Promise<IgnoreConfig>} the IgnoreConfig
 */
async function fetchIgnore(ctx, codeSource, evt, timer) {
  const { log } = ctx;
  const ref = evt.branch || evt.ref;
  const response = await fetchContent(ctx, codeSource, ref, '.hlxignore', evt.branch, 0, timer);
  if (response.ok) {
    return new IgnoreConfig().withSource(await response.text()).init();
  }
  if (response.status === 404) {
    log.info(`[code] No .hlxignore found in github ${codeSource.owner}/${codeSource.repo}/${ref}.`);
    return new IgnoreConfig().withSource('').init();
  }
  throw new StatusCodeError(`Unable to fetch hlxignore: ${response.status}`, response.status);
}

/**
 * Stores the sha of the current commit in the code-bus
 * @param ctx
 * @param codeSource
 * @param evt
 * @returns {Promise<void>}
 */
async function storeSha(ctx, codeSource, evt) {
  const path = `${evt.codePrefix}.sha`;
  try {
    const storage = HelixStorage.fromContext(ctx).codeBus();
    ctx.log.info(`[code][--] uploading ${path} to storage`);
    const meta = {
      'x-commit-id': evt.sha,
      'x-source-last-modified': new Date().toUTCString(),
    };
    await storage.put(path, evt.sha, 'text/plain', meta, false);
    ctx.log.info(`[code][--] uploaded ${path} to storage`);
  } catch (e) {
    ctx.log.error(`[code][--] uploading ${path} to storage failed: ${e.message}`);
  }
}

/**
 * Implements a code-sync job
 */
export class CodeJob extends Job {
  /**
   * Whether we use the code bus.
   */
  static USE_CODE_BUS = true;

  constructor(...args) {
    super(...args);

    this.githubTimer = {
      time: 0, fetch: 0, lastModified: 0,
    };
    this.storageTimer = {
      time: 0, get: 0, put: 0, remove: 0, head: 0,
    };
    this.bytesDownloaded = 0;
  }

  /**
   * Prepares the sync job and collected the list of resources to sync if needed.
   * the list of changes is stored in `this.state.changes`. the list of final resource
   * information is stored in `this.state.resources`.
   *
   * @param {CodeSource} codeSource
   */
  async collect(codeSource) {
    const { ctx, state: { data: /** @type {ChangeEvent} */ evt } } = this;
    const { log } = ctx;
    const {
      codeRef, codePrefix, codeOwner, codeRepo,
    } = evt;
    const storage = HelixStorage.fromContext(ctx).codeBus();

    // handle branch create
    const resources = [];
    this.state.data.resources = resources;

    // extract potential branch ops that don't need github access
    const branchOp = evt.changes.find((change) => change.path === '*' || change.path === '.hlxignore');

    // handle branch delete
    if (branchOp?.type?.toLowerCase() === 'deleted') {
      if (codeRef === 'main' || codeRef === 'master') {
        throw new StatusCodeError(`[${codePrefix}] cowardly refusing to delete potential default branch.`, 400);
      }
      this.state.data.deleteTree = true;
      resources.push(createResourceInfo(branchOp));
      return;
    }

    await logGithubRateLimit(ctx, evt, this.state.data, codeSource.octokit);

    // fetch ignore
    const ignore = await fetchIgnore(ctx, codeSource, evt, this.githubTimer);
    const pathFilter = (key) => {
      if (!key) {
        return false;
      }
      if (key === CONFIG_PATH) {
        // do not allow to overwrite the internal helix-config.json
        return false;
      }
      if (key === '.sha') {
        // ignore internal sha file
        return false;
      }
      if (key.startsWith('node_modules/') || key.indexOf('/node_modules/') >= 0) {
        return false;
      }
      if (!isValidPath(key)) {
        log.info('[code] ignoring path with unsupported characters:', key);
        return false;
      }
      return !ignore.ignores(key);
    };

    let ignoreModified = false;

    // check for branch delete or create, filter ignored changes
    let changes = evt.changes.filter((change) => {
      if (change.path === '*') {
        return false;
      }
      if (change.path === '.hlxignore') {
        ignoreModified = true;
        return false;
      }
      return pathFilter(change.path);
    });

    try {
      this.state.data.sha = await getRefSha(ctx, codeSource, evt.branch || evt.ref, evt.tag);
    } catch (e) {
      log.error(`[code][${codePrefix}] unable to get sha for ref ${evt.branch || evt.ref}: ${e.message}`);
      throw new StatusCodeError(`[${codePrefix}] branch not found.`, 404);
    }

    if (branchOp) {
      const baseRef = getCodeRef(evt.baseRef);
      let needsTreeSync = false;
      if (ignoreModified) {
        this.state.data.treeSyncReason = '.hlxignore modified';
        log.info(`[code][${codePrefix}*] .hlxignore modified enumerating files.`);
        needsTreeSync = true;
      } else if (evt.tag) {
        this.state.data.treeSyncReason = 'tag created';
        log.info(`[code][${codePrefix}*] tag created, enumerating files`);
        needsTreeSync = true;
      } else if (!baseRef) {
        this.state.data.treeSyncReason = 'no base ref';
        log.info(`[code][${codePrefix}*] no base ref for new branch. enumerating files`);
        needsTreeSync = true;
      } else if (baseRef === codeRef) {
        this.state.data.treeSyncReason = 'base ref identical to new branch';
        log.info(`[code][${codePrefix}*] base ref identical to new branch. enumerating files.`);
        needsTreeSync = true;
      } else {
        const hasBase = !!await storage.head(`/${codeOwner}/${codeRepo}/${baseRef}/.sha`);
        if (!hasBase) {
          this.state.data.treeSyncReason = 'base ref .sha does no exist';
          log.info(`[code][${codePrefix}*] base ref .sha on '${baseRef}' does not exist. enumerating files.`);
          needsTreeSync = true;
        } else {
          this.state.data.treeSyncReason = 'requested';
          log.info(`[code][${codePrefix}*] using base '${baseRef}' for new branch copy.`);
          const copied = await storage.copyDeep(`/${codeOwner}/${codeRepo}/${baseRef}/`, codePrefix, (info) => pathFilter(info.path));
          for (const change of copied) {
            resources.push(createResourceInfo(change));
          }
        }
      }
      if (needsTreeSync) {
        const treeChanges = await tree(ctx, codeSource, evt, this.state.data.sha);
        changes = treeChanges.map((c) => {
          if (!pathFilter(c.path)) {
            // eslint-disable-next-line no-param-reassign
            c.type = 'ignored';
          }
          return c;
        });
      }
    }

    await logGithubRateLimit(ctx, evt, this.state.data, codeSource.octokit);

    // set content type if missing and normalize event types to lowercase
    for (const change of changes) {
      // normalize event types to lowercase for case-insensitive handling
      if (change.type) {
        // eslint-disable-next-line no-param-reassign
        change.type = change.type.toLowerCase();
      }

      if (!change.contentType) {
        /* c8 ignore next */
        let contentType = mime.getType(change.path) || 'application/octet-stream';
        if (contentType.startsWith('text/') && contentType.indexOf('charset') < 0) {
          contentType += '; charset=utf-8';
        }
        // eslint-disable-next-line no-param-reassign
        change.contentType = contentType;
      }
    }
    // update sanitized changes
    evt.changes = changes;
  }

  /**
   * Syncs the github tree
   * @param {CodeSource} codeSource
   * @returns {Promise<void>}
   */
  async sync(codeSource) {
    const { ctx, state: { data: /** @type {ChangeEvent} */ evt } } = this;
    const { resources, changes, codePrefix } = evt;
    const { log } = ctx;
    const fetch = ctx.getFetch();

    const startTime = Date.now();
    const storage = HelixStorage.fromContext(ctx).codeBus();
    const contentBus = HelixStorage.fromContext(ctx).contentBus();

    if (this.state.data.deleteTree) {
      await storage.rmdir(codePrefix);
      return;
    }

    // ensure config all is loaded
    const headers = new ModifiersConfig(ctx.config.headers?.data, ALLOWED_HEADERS_FILTER);
    const { octokit } = codeSource;
    let counter = 0;
    const rateLimit = {
      ...RATE_LIMIT,
      abortController: new AbortController(),
    };

    // this is a bit a hack, since the processQueue doesn't propagate exceptions
    let error = null;
    /**
     * Processes the change
     * @param {Change} change
     * @param queue the queue
     * @param results result set
     * @param rateToken token of the rate limiter
     * @returns {Promise<void>}
     */
    const processChange = async (change, queue, results, rateToken) => {
      if (await this.checkStopped()) {
        rateLimit.abortController.abort();
        return;
      }
      // eslint-disable-next-line no-plusplus
      const nr = counter++;
      const path = `${codePrefix}${change.path}`;
      const oldFile = await measure(() => storage.head(path), this.storageTimer);
      // handle deleted
      if (change.type === 'deleted' || change.type === 'ignored') {
        // we don't rate limit ignored files, as they don't cause requests to github
        rateToken.release();
        try {
          this.storageTimer.head += 1;
          if (!oldFile) {
            if (change.type === 'ignored') {
              log.info(`[code][${nr}] ignored ${path} does not exist in storage.`);
              this.state.progress.ignored += 1;
            } else {
              log.info(`[code][${nr}] deleted ${path} does not exist in storage.`);
              this.state.progress.processed += 1;
            }
          } else {
            log.info(`[code][${nr}] removing ${path} from storage.`);
            await measure(() => storage.remove(path), this.storageTimer);
            this.storageTimer.remove += 1;
            this.state.progress.processed += 1;
            if (evt.ref === 'main') {
              const { name } = OTHER_CONFIG_FILES[change.path] || {};
              if (name) {
                const { contentBusId } = ctx.config.content;
                const contentPath = `${contentBusId}/preview/.helix/${name}.yaml`;
                const hlx = await fetchHlxJson(ctx, contentBusId);
                const project = `${evt.codeOwner}/${evt.codeRepo}`;
                // since repo == site is enforced, we can remove when the original site matches
                if (hlx?.['original-site'] === project) {
                  log.info(`[code][${nr}] removing ${contentPath} from storage.`);
                  await measure(() => contentBus.remove(contentPath), this.storageTimer);
                  this.storageTimer.remove += 1;
                } else {
                  log.info(`[code][${nr}] not removing ${contentPath} from storage: original site is: ${hlx?.['original-site']}`);
                }
              }
            }
            resources.push(createResourceInfo(change, 204));
          }
        } catch (e) {
          log.error(`[code][${nr}] removing ${path} from storage failed: ${e.message}`);
          resources.push(createResourceInfo(change, 500, e.message));
          this.state.progress.failed += 1;
        }
        await this.writeStateLazy();
        return;
      }

      // read from github
      let body;
      const ref = change.commit || evt.branch || evt.ref;
      try {
        // eslint-disable-next-line max-len
        const res = await fetchContent(ctx, codeSource, ref, change.path, evt.branch, nr, this.githubTimer);
        if (!res.ok) {
          // error already logged in fetchContent()
          resources.push(createResourceInfo(change, res.status, 'error reading from github'));
          this.state.progress.failed += 1;
          await this.writeStateLazy();
          return;
        }
        body = await res.buffer();

        // eslint-disable-next-line no-param-reassign
        change.contentLength = body.length;
        this.bytesDownloaded += body.length;

        if (change.time) {
          // eslint-disable-next-line no-param-reassign
          change.lastModified = new Date(change.time).toUTCString();
        }
        if (!change.lastModified) {
          const commitsUrl = new URL(`${codeSource.base_url}/repos/${codeSource.owner}/${codeSource.repo}/commits?page=1&per_page=1`);
          commitsUrl.searchParams.append('sha', ref);
          commitsUrl.searchParams.append('path', change.path);
          const commitsRes = await measure(() => fetch(commitsUrl, {
            timeout: 20000,
            headers: {
              authorization: `token ${codeSource.token}`,
            },
            cache: 'no-store',
          }), this.githubTimer);
          this.githubTimer.lastModified += 1;
          if (!commitsRes.ok) {
            await logGithubErrorResponse(log, commitsRes, nr, `error fetching commits for ${commitsUrl} (branch: ${evt.branch}) from github`);
          } else {
            const commitsJson = await commitsRes.json();
            // eslint-disable-next-line no-param-reassign
            const dateStr = commitsJson[0]?.commit?.committer?.date;
            if (dateStr) {
              // eslint-disable-next-line no-param-reassign
              change.lastModified = new Date(dateStr).toUTCString();
            }
            if (!change.commit) {
              // eslint-disable-next-line no-param-reassign
              change.commit = commitsJson[0]?.sha;
            }
          }
        }

        // check if github last modified is newer than the existing one in code-bus. we don't want
        // to travel back in time, as this only give problems with cache invalidation.
        if (oldFile?.LastModified && change.lastModified) {
          const oldDate = new Date(oldFile.LastModified);
          const newDate = new Date(change.lastModified);
          if (newDate <= oldDate) {
            log.info(`[code][${nr}] ignoring last modified from github. last modified is older than existing file in code-bus: ${path}`);
            oldDate.setSeconds(oldDate.getSeconds() + 1);
            // eslint-disable-next-line no-param-reassign
            change.lastModified = oldDate.toUTCString();
          }
        }

        log.info(`[code][${nr}] fetched ${codeSource.owner}/${codeSource.repo}/${ref}/${path} from github. ${body?.length} bytes`);
      } catch (e) {
        if (e instanceof RateLimitError) {
          // abort
          changes.unshift(change); // retry that resource the next time again
          error = e;
          rateLimit.abortController.abort();
          return;
        }
        log.error(`[code][${nr}] reading ${codeSource.owner}/${codeSource.repo}/${ref}/${path} from github error: ${e.message}`);
        resources.push(createResourceInfo(change, 500, `error reading from github: ${e.message}`));
        this.state.progress.failed += 1;
        await this.writeStateLazy();
        return;
      }

      try {
        log.info(`[code][${nr}] uploading ${path} to storage`);
        const meta = {
          ...headers.getModifiers(`/${change.path}`),
          'x-commit-id': change.commit || '',
        };
        if (change.lastModified) {
          meta['x-source-last-modified'] = change.lastModified;
        }
        let compress = true;
        if (path.endsWith('.mp3') || path.endsWith('.mp4') || path.endsWith('.webm')) {
          log.info(`[code][${nr}] storing ${path} uncompressed`);
          compress = false;
        }
        await measure(
          () => storage.put(path, body, change.contentType, meta, compress),
          this.storageTimer,
        );
        this.storageTimer.put += 1;
        resources.push(createResourceInfo(change));
        log.info(`[code][${nr}] uploaded ${path} to storage`);
      } catch (e) {
        log.error(`[code][${nr}] uploading ${path} to storage failed: ${e.message}`);
        resources.push(createResourceInfo(change, 500, `uploading failed: ${e.message}`));
        this.state.progress.failed += 1;
        await this.writeStateLazy();
        return;
      }

      this.state.progress.processed += 1;
      await this.writeStateLazy();
    };

    // get current rate limits before and after processing the queue
    await logGithubRateLimit(ctx, evt, this.state.data, octokit);
    await processQueue(changes, processChange, rateLimit);
    if (error) {
      throw error;
    }
    await storeSha(ctx, codeSource, evt);
    await logGithubRateLimit(ctx, evt, this.state.data, octokit);

    const stopTime = Date.now();
    log.info('%j', {
      metric: {
        metric: 'code-sync',
        owner: evt.owner,
        repo: evt.repo,
        ref: evt.codeRef,
        installationId: evt.installationId,
        time: stopTime - startTime,
        downloaded: this.bytesDownloaded,
        github: this.githubTimer,
        storage: this.storageTimer,
        treeSync: evt.treeSyncReason || 'n/a',
      },
    });
  }

  /**
   * Post process changes that affect `helix-config.json`
   */
  async postProcessHelixConfig() {
    if (this.state.data.deleteTree) {
      return;
    }

    const { ctx, state: { data: /** @type {ChangeEvent} */ evt } } = this;
    const {
      resources, codeOwner, codeRepo, ref,
    } = evt;
    const { log } = ctx;
    const info = {
      owner: evt.codeOwner,
      repo: evt.codeRepo,
      ref: evt.codeRef,
      org: this.info.org,
      site: this.info.site,
      route: 'code',
    };

    // check for config changes
    let doPurgeConfig = false;

    for (const resource of resources) {
      if (resource.status < 300) {
        const key = resource.resourcePath.substring(1);
        if (key === 'head.html') {
          doPurgeConfig = true;
          info.purgeHead = true;
        } else if (ref === 'main' && key === 'tools/sidekick/config.json') {
          doPurgeConfig = true;
        } else if (ref === 'main' && key === 'robots.txt') {
          doPurgeConfig = true;
        }
      }
    }
    // purge config with _head surrogate for tree syncs, as they might invalidate the config
    if (this.state.data.treeSyncReason) {
      log.info(`[code] forcing config purge for ${codeOwner}/${codeRepo}/${ref} due to tree sync: ${this.state.data.treeSyncReason}`);
      doPurgeConfig = true;
      info.purgeHead = true;
    }

    // check if config was modified
    if (doPurgeConfig) {
      await purge.config(ctx, info);
    }
  }

  /**
   * Post process changes that affect `helix-query.yaml` and `helix-sitemap.yaml`
   */
  async postProcessOtherConfig() {
    if (this.state.data.deleteTree) {
      return;
    }

    const { ctx, state: { data: /** @type {ChangeEvent} */ evt } } = this;
    /** @type {{resources: Resource[]}} */
    const {
      resources, codeOwner: owner, codeRepo: repo,
    } = evt;
    const { log } = ctx;

    // check for config changes
    const contentBus = HelixStorage.fromContext(ctx).contentBus();
    const { contentBusId } = ctx.config.content;
    const configChanges = {};

    for (const resource of resources) {
      const { resourcePath, status, deleted = false } = resource;
      const key = resourcePath.substring(1);
      if (status < 300 && OTHER_CONFIG_FILES[key] && evt.ref === 'main') {
        const hlx = await fetchHlxJson(ctx, contentBusId);
        const project = `${owner}/${repo}`;
        if (hlx?.['original-site'] === project) {
          configChanges[key] = { deleted };
        } else {
          log.info(`[code] ignoring change to ${key}: original repository is: ${hlx?.['original-site']}`);
        }
      }
    }
    if (Object.keys(configChanges).length === 0) {
      log.info('[code] no other config files modified');
      return;
    }
    const codeBus = HelixStorage.fromContext(ctx).codeBus();

    try {
      // load all the new config files
      for (const key of Object.keys(configChanges)) {
        const { attribute, name, Loader } = OTHER_CONFIG_FILES[key];
        const change = configChanges[key];

        const contentPath = `${contentBusId}/preview/.helix/${name}.yaml`;
        if (change.deleted) {
          log.info('[code] removing', contentPath);
          await contentBus.remove(contentPath);
        } else {
          const objectMeta = {};
          change.data = await codeBus.get(`/${owner}/${repo}/main/${key}`, objectMeta);
          ctx.attributes[attribute] = await new Loader().withSource(change.data.toString('utf-8')).init();
          change.lastModified = objectMeta.lastModified;
          configChanges[key] = change;

          log.info('[code] uploading', contentPath);
          await contentBus.put(contentPath, change.data, 'text/yaml', {}, false);
        }
      }
    } catch (e) {
      log.error(`[code] Unable to store other config: ${e.message}`);
    }
  }

  async postProcess() {
    await this.postProcessHelixConfig();
    await this.postProcessOtherConfig();
  }

  async flushCache() {
    const { ctx, state: { data: /** @type {ChangeEvent} */ evt } } = this;
    const {
      resources, codeOwner, codeRepo, codeRef,
    } = evt;

    const info = {
      owner: codeOwner,
      repo: codeRepo,
      ref: codeRef,
      org: this.info.org,
      site: this.info.site,
    };

    if (this.state.data.deleteTree) {
      await purge.perform(ctx, info, [{
        key: `${codeRef}--${codeOwner}--${codeRepo}`,
      }, {
        key: `${codeRef}--${codeOwner}--${codeRepo}_code`,
      }], PURGE_PREVIEW_AND_LIVE, codeRef);
      return;
    }

    // purge live cdn of modified content
    const purgePaths = resources
      .filter(({ status }) => status === 200 || status === 204)
      .map(({ resourcePath }) => resourcePath);
    await purge.code(ctx, info, purgePaths);
  }

  /**
   * Helper for retrying a function with rate limit handling.
   * Waits and retries if a RateLimitError is thrown, up to the allowed deadline.
   * @param {Function} fn - The function to execute.
   * @param {string} phaseName - The name of the current phase.
   * @param {object} codeSource - The code source context.
   * @returns {Promise<void>}
   */
  async runWithRetry(fn, phaseName, codeSource) {
    let waitTime = 0;
    do {
      await this.idleWait(waitTime);
      waitTime = 0;
      try {
        await fn(codeSource);
      } catch (e) {
        if (e instanceof RateLimitError) {
          let { retryAfter } = e;
          if (!retryAfter) {
            retryAfter = Date.now() + 60_000; // wait 1 minute
          }
          // we don't check if the wait time is beyond the lambda runtime but let it die
          // and continue later. this allows of rate limit waits long than 15 minutes.
          waitTime = retryAfter - Date.now();
          this.ctx.log.info(`Ratelimit error from github. waiting for ${waitTime}ms`);
        }
      }
    } while (waitTime > 0);
  }

  /**
   * Extracts the branch information for the history.
   * @param state
   * @return {object}
   */
  // eslint-disable-next-line class-methods-use-this
  extractHistoryExtraInfo(state) {
    if (state.data?.branch) {
      return {
        branch: state.data.branch,
      };
    }
    return {};
  }

  /**
   * runs the code job.
   * @return {Promise<void>}
   */
  async run() {
    const {
      ctx,
      info,
      topic,
      name,
      state: {
        data: { deploymentAllowed },
      },
    } = this;
    let { deploymentId, deploymentOk } = this.state.data;

    if (this.state.data.phase === 'collect') {
      if (!this.state.waiting) {
        // todo: implement resume for content-source listing
        throw new Error('job cannot be resumed during the collect phase. please provide a smaller input set.');
      }
      this.state.data.phase = '';
    }

    const codeSource = await getCodeSource(ctx, this.state.data);

    // override env and context for byogit
    ctx.env.GH_RAW_URL = codeSource.raw_url;
    ctx.env.GH_BASE_URL = codeSource.base_url;

    const { octokit } = codeSource;
    const url = Job.getApiLink(info, topic, name);

    if (!this.state.data.phase) {
      if (deploymentAllowed && !deploymentOk) {
        if (deploymentId) {
          deploymentOk = await updateDeployment(ctx, octokit, deploymentId, codeSource, info, { state: 'in_progress', url });
        } else {
          deploymentId = await createDeployment(ctx, octokit, codeSource, info, { state: 'in_progress', url });
          deploymentOk = !!deploymentId;
          this.state.data.deploymentId = deploymentId;
        }
        this.state.data.deploymentOk = deploymentOk;
        await this.writeState();
      }

      await this.setPhase('collect');
      await this.runWithRetry(this.collect.bind(this), 'collect', codeSource);
      await this.trackProgress({
        total: this.state.data.resources.length || this.state.data.changes?.length || 0,
        ignored: 0,
      });
      await this.setPhase('sync');
    }
    if (this.state.data.phase === 'sync') {
      await this.runWithRetry(this.sync.bind(this), 'sync', codeSource);
      await this.setPhase('postprocess');
    }
    if (this.state.data.phase === 'postprocess') {
      await this.postProcess();
      await this.setPhase('purge');
    }
    if (this.state.data.phase === 'purge') {
      await this.flushCache();
      await this.setPhase('completed');
    }

    if (deploymentOk) {
      const state = this.state.data.phase === 'completed' ? 'success' : 'failure';
      await updateDeployment(ctx, octokit, deploymentId, codeSource, info, { state, url });
    }
  }
}
