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
import { Response } from '@adobe/fetch';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { errorResponse } from '../support/utils.js';
import GoogleMatcher from './matcher/google.js';
import SharepointMatcher from './matcher/sharepoint.js';
import GithubMatcher from './matcher/github.js';
import { Inventory } from './inventory.js';

const MATCHERS = [
  GoogleMatcher,
  SharepointMatcher,
  GithubMatcher,
];

/**
 * List of repositories where forks should be hidden.
 */
const HIDE_FORKS = [
  'adobe/aem-boilerplate',
];

/**
 * Lookup all original repositories and gdrive IDs where forks should be hidden
 * in query results.
 *
 * @param {Array<InventoryEntry>} entries entries
 * @returns list of original repositories and gdrive IDs to hide forks for
 */
function lookupHiddenForks(entries) {
  const hiddenForks = entries.filter((entry) => HIDE_FORKS
    .some((codeBusId) => entry.codeBusId === codeBusId));
  return {
    originalSites: hiddenForks.map(({ originalSite }) => originalSite),
    gdriveIds: hiddenForks.map(({ gdriveId }) => gdriveId).filter((gdriveId) => !!gdriveId),
  };
}

/**
 * Mark original site.
 *
 * @param {object} entry entry
 * @returns entry with originalSite either `true` or `false`
 */
function markOriginalSite(entry) {
  const originalSite = entry.originalSite === `${entry.org}/${entry.site}`;
  return {
    ...entry,
    originalRepository: originalSite, // todo: remove once sidekick is adjusted
    originalSite,
  };
}

/**
 * Remove sensitive data from an inventory entry.
 *
 * @param {object} entry sensitive data
 * @returns entry without sensitive data
 */
function removeSensitiveData(entry) {
  // eslint-disable-next-line no-param-reassign
  delete entry?.gdriveId;
  // eslint-disable-next-line no-param-reassign
  delete entry?.sharepointSite;
  return entry;
}

/**
 * Add a link to the GitHub repository.
 *
 * @param {object} entry entry
 * @returns entry with githubUrl
 */
function addRepositoryLink(entry) {
  return {
    ...entry,
    githubUrl: `https://github.com/${entry.codeBusId}`,
  };
}

/**
 * Add legacy information to an inventory entry.
 *
 * @param {object} entry entry
 * @returns entry with githubUrl
 */
function addLegacyInformation(entry) {
  return {
    ...entry,
    originalRepository: entry.originalSite,
    owner: entry.org,
    repo: entry.site,
  };
}

/**
 * Query owner, repo and content bus ID for some project.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @returns {Promise<Response>} response
 */
export default async function query(context) {
  const { attributes: { authInfo }, data: { url: urlString }, log } = context;
  if (!urlString) {
    return errorResponse(log, 400, 'discover requires a `url` parameter');
  }

  let url;
  if (urlString === '*') {
    authInfo.assertPermissions('discover:list');
  } else {
    try {
      url = new URL(urlString);
    } catch (e) {
      return errorResponse(log, 400, `URL is malformed: ${urlString}: ${e.message}`);
    }
    authInfo.assertPermissions('discover:peek');
  }

  const inventory = new Inventory(HelixStorage.fromContext(context).contentBus(), log);
  if (!await inventory.load()) {
    return errorResponse(log, 404, 'inventory not available');
  }

  let entries = inventory.entries();

  if (url) {
    const Matcher = MATCHERS.find((m) => m.match(url, inventory));
    if (!Matcher) {
      return errorResponse(log, 404, `no matcher found for ${url}`);
    }
    const matcher = new Matcher(context.env);
    entries = await matcher.filter(context, url, inventory);
  }

  const { originalSites, gdriveIds } = lookupHiddenForks(entries);

  entries = entries
    .filter((entry) => {
      // filter out those entries that have a hidden fork as original site
      // but are not the original site
      const { org, site, originalSite } = entry;
      const siteId = `${org}/${site}`;
      if (originalSites.includes(originalSite)) {
        return siteId === originalSite;
      }

      // filter out those entries that have a gdriveId of a hidden fork
      const { gdriveId } = entry;
      if (gdriveId && gdriveIds.includes(gdriveId)) {
        return false;
      }
      return true;
    })
    .map(removeSensitiveData)
    .map(markOriginalSite)
    .map(addRepositoryLink)
    .map(addLegacyInformation);

  if (!authInfo.hasPermissions('discover:read')) {
    entries = entries
      .map(({
        org, site, originalRepository, originalSite,
      }) => ({
        org,
        site,
        originalRepository,
        originalSite,
        owner: org,
        repo: site,
      }));
  }
  return new Response(JSON.stringify(entries), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
