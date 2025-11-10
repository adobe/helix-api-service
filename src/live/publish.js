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
import purge, { PURGE_LIVE, PURGE_PREVIEW_AND_LIVE } from '../cache/purge.js';
import { REDIRECTS_JSON_PATH } from '../contentbus/contentbus.js';
import indexUpdate from '../index/update.js';
import { fetchExtendedIndex, getIndexTargets } from '../index/utils.js';
import { updateRedirects } from '../redirects/update.js';
import sitemap from '../sitemap/update.js';
import { installSimpleSitemap } from '../sitemap/utils.js';
import update from './update.js';

/**
 * Check whether a JSON published is actually the source of a sitemap, and if it isn't
 * an index target at the same time, it will determine whether the underlying sitemap
 * changed.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('@adobe/helix-shared-indexer').IndexConfig} index index config
 */
async function checkSitemapSourceChange(context, info, index) {
  const { log } = context;
  const { resourcePath } = info;

  if (index) {
    const targets = getIndexTargets(index);
    if (targets.includes(resourcePath)) {
      log.debug(`JSON published is an index target, will not check sitemap change: ${resourcePath}`);
      return;
    }
  }
  const response = await sitemap.sourceChanged(context, info, {
    source: resourcePath,
    updatePreview: true,
  });
  if (response.status === 200) {
    const { paths } = await response.json();
    await purge.content(context, info, paths, PURGE_PREVIEW_AND_LIVE);
  }
}

/**
 * Publish a resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function publish(context, info) {
  const { log, data: { forceUpdateRedirects } } = context;
  const { resourcePath, ext } = info;

  let oldRedirects;
  if (resourcePath === REDIRECTS_JSON_PATH) {
    if (forceUpdateRedirects) {
      oldRedirects = {};
      log.warn('forcing update of redirects due to specified request parameter.');
    } else {
      oldRedirects = await context.getRedirects('live');
      delete context.attributes.redirects;
    }
  }

  const response = await update(context, info);
  if (response.status !== 200) {
    return response;
  }

  await purge.resource(context, info, PURGE_LIVE);

  if (oldRedirects) {
    const newRedirects = await context.getRedirects('live');
    const updated = await updateRedirects(context, 'live', oldRedirects, newRedirects);
    await purge.redirects(context, info, updated, PURGE_LIVE);
    // TODO await removePages(context, info, updated);

    // redirects don't need to be indexed
  } else {
    const index = await fetchExtendedIndex(context, info);
    await installSimpleSitemap(context, info, false);
    if (index) {
      await indexUpdate(context, info, index, { lastPublished: new Date() });
    }
    if (ext === '.json') {
      await checkSitemapSourceChange(context, info, index);
    }
  }

  // TODO
  // if (!context.data?.disableNotifications) {
  //   // todo: only notify if the resource was modified or newer
  //   await getNotifier(context).publish('resource-published', info, {
  //     status: response.status,
  //     resourcePath: info.resourcePath,
  //   });
  // }

  return response;
}
