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
import { ModifiersConfig } from '@adobe/helix-shared-config';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { ALLOWED_HEADERS_FILTER } from '../support/utils.js';

/**
 * Updates the redirects in the content bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} partition what partition to update
 * @param {object} oldRedirects the map of old redirects
 * @param {object} newRedirects the map of new redirects
 * @return {Promise<string[]>} updated redirects
 */
export async function updateRedirects(context, partition, oldRedirects, newRedirects) {
  const {
    config, contentBusId, log, data: { forceUpdateRedirects },
  } = context;

  const storage = HelixStorage.fromContext(context).contentBus();
  const stats = {
    totalOld: 0,
    totalNew: 0,
    modified: 0,
    updated: 0,
    deleted: 0,
    ignored: 0,
    added: 0,
  };

  // compute the diff
  const modified = {};
  Object.entries(oldRedirects).forEach(([name, value]) => {
    stats.totalOld += 1;
    const newValue = newRedirects[name];
    if (newValue !== value) {
      modified[name] = newValue;
    }
  });
  Object.entries(newRedirects).forEach(([name, value]) => {
    stats.totalNew += 1;
    if (!oldRedirects[name]) {
      modified[name] = value;
    }
  });

  const headers = new ModifiersConfig(config.headers, ALLOWED_HEADERS_FILTER);

  // update the modified redirects
  const updated = [];
  const deleted = [];
  await processQueue(
    Object.entries(modified),
    /**
     * Processes the modified redirects
     * @param {string} name redirect resource path
     * @param {string} value redirect target
     * @returns {Promise<void>}
     */
    async ([name, value]) => {
      stats.modified += 1;
      const path = `/${contentBusId}/${partition}${name}`;
      try {
        // read existing resource
        const res = await storage.head(path);
        if (!res && !value) {
          // if resource does not exist, and redirect was deleted, do nothing
          stats.ignored += 1;
          return;
        }

        if (res) {
          /* c8 ignore next */
          const meta = res?.Metadata ?? {};

          // if no content resource and redirect was deleted, schedule for deletion
          if (!value && !meta['x-source-location']) {
            // schedule for deletion
            log.info(`scheduling redirect ${path} for deletion.`);
            deleted.push({
              path,
              name,
            });
            stats.deleted += 1;
            return;
          }

          if (meta['redirect-location'] === value) {
            // redirect already in place. ignore
            stats.ignored += 1;
            if (forceUpdateRedirects) {
              // add to updated list, so it gets purged nonetheless.
              updated.push(name);
            }
            return;
          }

          // for existing resources, update the meta
          if (value) {
            log.info(`updating redirect-location meta on ${path}`);
            // if pure redirect, apply custom headers
            if (!meta['x-source-location']) {
              Object.assign(meta, headers.getModifiers(path));
            }
            meta['redirect-location'] = value;
          } else {
            log.info(`removing redirect-location meta from ${path}`);
            delete meta['redirect-location'];
          }
          const opts = {};
          for (const key of Object.values(HelixStorage.AWS_S3_SYSTEM_HEADERS)) {
            if (res[key]) {
              opts[key] = res[key];
            }
          }
          stats.updated += 1;
          await storage.putMeta(path, meta, opts);
          updated.push(name);
          return;
        }

        log.info(`creating redirect object for ${path}`);
        await storage.put(path, value, 'text/plain', {
          ...headers.getModifiers(path),
          'redirect-location': value,
        }, false);
        stats.added += 1;
        updated.push(name);
      } catch (e) {
        log.error(`uploading ${path} to storage failed: ${e.message}`);
      }
    },
    32,
  );

  // delete the removed redirects
  if (deleted.length) {
    try {
      await storage.remove(deleted.map(({ path }) => path), '', true);
      updated.push(...deleted.map(({ name }) => name));
    } catch (e) {
      log.error(`deleting redirects from storage failed: ${e.message}`);
    }
  }

  log.info('updated redirects', stats);
  return updated;
}

/**
 * Updates the redirect addressed in `info.webPath` in the content bus.
 * If successful, the redirect location is returned, otherwise the result undefined.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<string>} redirect location or undfined
 */
export async function updateRedirect(context, info) {
  const { log } = context;
  const partition = info.route === 'preview' ? 'preview' : 'live';

  // check if redirects contain the source
  const redirectPath = info.toResourcePath();
  const redirects = await context.getRedirects(partition);
  const redirectLocation = redirects[redirectPath];
  if (redirectLocation) {
    await updateRedirects(context, partition, [], {
      [redirectPath]: redirectLocation,
    });
    log.info(`updated redirect for ${redirectPath}: ${redirectLocation}`);
  }
  return redirectLocation;
}
