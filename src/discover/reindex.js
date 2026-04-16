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

import { basename } from 'path';
import { Response } from '@adobe/fetch';
import processQueue from '@adobe/helix-shared-process-queue';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { GoogleMatcher } from './matcher/GoogleMatcher.js';
import { SharepointMatcher } from './matcher/SharepointMatcher.js';
import { Inventory } from './Inventory.js';
import { fetchHlxJson, loadSiteConfig } from '../config/utils.js';
import { generate } from './cdn-identifier.js';

const MATCHERS = {
  google: GoogleMatcher,
  onedrive: SharepointMatcher,
};

/**
 * Create an inventory entry for some project.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('@adobe/helix-shared-storage').Bucket} contentBus content bus ticket
 * @param {string} org org
 * @param {string} site site
 * @param {object} matchers matchers
 * @returns {Promise<import('./Inventory.js').InventoryEntry>}
 */
async function createEntry(context, contentBus, org, site, matchers) {
  const config = await loadSiteConfig(context, org, site);
  if (!config) {
    return null;
  }

  const { code, content } = config;
  const entry = {
    org,
    site,
    contentSourceUrl: content.source.url,
    contentBusId: content.contentBusId,
    codeBusId: `${code.owner}/${code.repo}`,
  };

  const cdnId = generate(config);
  if (cdnId) {
    entry.cdnId = cdnId;
  }

  const hlx = await fetchHlxJson(context, entry.contentBusId);
  if (hlx?.['original-site']) {
    entry.originalSite = hlx['original-site'];
  } else if (hlx?.['original-repository']) {
    entry.originalRepository = hlx['original-repository'];
  }

  const matcher = matchers[content.source.type];
  if (matcher) {
    await matcher.extract(context, new URL(entry.contentSourceUrl), entry);
  }
  return entry;
}

/**
 * Create the complete repository inventory for all sites found in the config bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('@adobe/helix-shared-storage').Bucket} contentBus content bus bucket
 * @param {object} matchers matchers
 * @returns {Promise<Inventory>}
 */
async function createInventory(context, contentBus, matchers) {
  const { log } = context;

  const inventory = new Inventory(contentBus, log);

  const configBus = HelixStorage.fromContext(context).configBus();
  const folders = await configBus.listFolders('orgs/');
  log.info(`found ${folders.length} folders in /orgs/`);

  const sites = [];
  await processQueue(folders, async (folder) => {
    const org = folder.split('/')[1];
    const siteObjects = await configBus.list(`${folder}sites/`, true);
    for (const { path } of siteObjects) {
      if (path.endsWith('.json')) {
        const site = basename(path, '.json');
        sites.push({
          org,
          site,
        });
      }
    }
  }, 64);
  log.info(`found ${sites.length} sites`);

  await processQueue(sites, async ({ org, site }) => {
    const entry = await createEntry(context, contentBus, org, site, matchers);
    if (entry) {
      inventory.appendEntry(entry);
    }
  });
  return inventory;
}

/**
 * Reindex all projects.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @returns {Promise<Response>} response
 */
export async function reindexAll(context) {
  const contentBus = HelixStorage.fromContext(context).contentBus();

  const matchers = Object.fromEntries(
    Object.entries(MATCHERS)
      .map(([name, Matcher]) => [name, new Matcher(context.env)]),
  );

  const inventory = await createInventory(context, contentBus, matchers);
  await inventory.save();

  return new Response();
}

/**
 * Reindex some project.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} org org
 * @param {string} site site
 * @returns {Promise<Response>} response
 */
export async function reindexProject(context, org, site) {
  const { log } = context;

  const contentBus = HelixStorage.fromContext(context).contentBus();
  const matchers = Object.fromEntries(
    Object.entries(MATCHERS)
      .map(([name, Matcher]) => [name, new Matcher(context.env)]),
  );

  const entry = await createEntry(context, contentBus, org, site, matchers);
  if (!entry) {
    return new Response('', {
      status: 404,
      headers: {
        'x-error': `Unable to obtain information on project ${org}/${site}`,
      },
    });
  }

  const inventory = new Inventory(contentBus, log);
  await inventory.load();

  if (inventory.addEntry(entry)) {
    await inventory.save();
    // return entry information for debugging
    return new Response(entry, { status: 201 });
  }
  // return entry information for debugging
  return new Response(entry, { status: 200 });
}

/**
 * Sets the original site information in the content bus metadata.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} org organization name
 * @param {string} site site name
 * @returns {Promise<string>} previous organization and site name if changed.
 */
export async function setOriginalSite(context, org, site) {
  const config = await loadSiteConfig(context, org, site);
  const contentBusId = config?.content?.contentBusId;
  if (contentBusId) {
    const contentBus = HelixStorage.fromContext(context).contentBus();
    const infoKey = `${contentBusId}/.hlx.json`;
    const buf = await contentBus.get(infoKey);
    const meta = buf ? JSON.parse(buf) : {};
    const oldSite = meta['original-site'];
    const newSite = `${org}/${site}`;
    if (oldSite !== newSite) {
      meta['original-site'] = newSite;
      await contentBus.put(infoKey, Buffer.from(JSON.stringify(meta, null, 2)), 'application/json', meta, false);
      context.log.info(`[discover] claimed original-site of ${newSite} (was: ${oldSite})`);
      return oldSite;
    }
  }
  /* c8 ignore next */
  return '';
}

/**
 * Reindex one or all projects.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @returns {Promise<Response>} response
 */
export async function reindex(context) {
  const { authInfo, data } = context;
  if (data.org === '*') {
    return reindexAll(context);
  }
  if (data.org && data.site) {
    if (String(data.claimOriginalSite) === 'true') {
      // only allow the devops to change the original-site
      authInfo.assertPermissions('discover:ops');
      const oldSite = await setOriginalSite(context, data.org, data.site);
      if (oldSite) {
        const [org, site] = oldSite.split('/');
        await reindexProject(context, org, site);
      }
    }
    return reindexProject(context, data.org, data.site);
  }
  return new Response('', {
    status: 400,
    headers: {
      'x-error': 'reindex requires `org` or `org` and `site`',
    },
  });
}
