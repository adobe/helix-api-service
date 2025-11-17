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
import GoogleMatcher from './matcher/google.js';
import SharepointMatcher from './matcher/sharepoint.js';
import { Inventory } from './inventory.js';
import { fetchHlxJson, loadSiteConfig } from '../config/utils.js';
import { generate } from './cdn-identifier.js';
import { removeProject } from './remove.js';

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
 * @returns {Promise<import('./inventory.js').InventoryEntry>}
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

  const hlx = await fetchHlxJson(contentBus, entry.contentBusId);
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
 * Called when the configuration of a Helix 5 project has changed. Eventually
 * reindexes or removes the project from our inventory.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {object|null} oldConfig old configuration, may be `null`
 * @param {object|null} newConfig new configuration, may be `null`
 * @param {string} org org
 * @param {string} site site
 */
export async function projectChanged(context, oldConfig, newConfig, org, site) {
  const { log } = context;

  if (oldConfig != null && newConfig === null) {
    // configuration removed, so remove project from discovery
    await removeProject(context, org, site);
    return;
  }
  if (oldConfig === null) {
    // configuration created, so add that project
    await reindexProject(context, org, site);
    return;
  }

  // at this point, we have both an old and a new configuration
  const signature = (config) => [
    config.content.contentBusId,
    config.code.owner,
    config.code.repo,
    generate(config)].join();
  const oldSig = signature(oldConfig);
  const newSig = signature(newConfig);
  if (oldSig !== newSig) {
    log.info(`[discover] project signature changed: ${oldSig} -> ${newSig}`);
    await reindexProject(context, org, site);
  } else {
    log.info(`[discover] project signature stable : ${oldSig}`);
  }
}

/**
 * Reindex one or all projects.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @returns {Promise<Response>} response
 */
export default async function reindex(context) {
  const { data: { org, site } } = context;
  if (org === '*') {
    return reindexAll(context);
  }
  if (org && site) {
    return reindexProject(context, org, site);
  }
  return new Response('', {
    status: 400,
    headers: {
      'x-error': 'reindex requires `org` or `org` and `site`',
    },
  });
}
