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
import { getCachePlugin } from '@adobe/helix-shared-tokencache';
import processQueue from '@adobe/helix-shared-process-queue';

/**
 * Build an object containing all gdrive root ids as keys.
 *
 * @param {array} inventory inventory of repositories
 * @returns object with gdrive root ids
 */
function buildRoots(inventory) {
  return inventory.filter(({ gdriveId }) => !!gdriveId)
    .reduce((roots, { gdriveId }) => {
      // eslint-disable-next-line no-param-reassign
      roots[gdriveId] = '/';
      return roots;
    }, {});
}

/**
 * A custom user consists of a project (org/site) and a content bus id.
 *
 * @typedef CustomUser
 * @property {string} project
 * @property {string} contentBusId
 */

/**
 * Matcher that filters inventory entries against known google drives.
 */
export default class GoogleMatcher {
  constructor(env) {
    this.customUserProjects = (env.HLX_CUSTOM_GOOGLE_USERS ?? '').split(',')
      .map((project) => {
        const [org, site] = project.trim().split('/');
        return {
          org,
          site,
          match: (entry) => org === entry.org && (site === '*' || site === entry.site),
        };
      });
  }

  /**
   * Return all custom users that we should use to lookup Google items.
   *
   * @param {import('../inventory.js').InventoryEntry[]} entries entries
   * @returns {CustomUser[]}
   */
  #getCustomUsers(entries) {
    return this.customUserProjects.reduce((users, { org, site }) => {
      // for orgs (i.e. site = '*'), return just the first custom user
      // adorned project in that org. this avoids doing a lookup with
      // the same registered user multiple times
      const entry = entries.find((e) => !!e.customUser
        && e.org === org && (site === '*' || e.site === site));
      if (entry) {
        const { contentBusId } = entry;
        users.push({ project: `${org}/${entry.site}`, contentBusId });
      }
      return users;
    }, []);
  }

  /**
   * Find the inventory entries that have the given google document, spreadsheet
   * or folder in their tree.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {URL} url google document or spreadsheet
   * @param {Inventory} inventory inventory of entries
   */
  async filter(context, url, inventory) {
    const { log } = context;

    const segs = url.pathname.split('/');
    let id = segs.pop();
    if (id.startsWith('edit')) {
      id = segs.pop();
    }
    if (id === '') {
      log.info(`Google URL contains no id: ${url}`);
      return [];
    }

    // finding the inventory items for google is a bit more tricky, as we can't match the url with
    // the mountpoint, because everything is just an ID. we need to lookup the hierarchy of the
    // item in the url; but for that we need to use the correct connected user. fortunately,
    // 99% of the projects use the default google user, so we try to resolve with that first.
    // if the item specified in the url id is not found, we need to traverse all google entries
    // with the `customUser` flag and try to load it using the entry user.

    try {
      const entries = inventory.entries();

      // trivial case, id == mountpoint
      let ret = entries.filter(({ gdriveId }) => gdriveId === id);
      if (ret.length) {
        // we don't want to support overlapping projects, so we return the once found here
        log.info('%j', {
          discover: {
            id,
            count: ret.length,
            client: false,
          },
        });
        return ret;
      }

      // resolve using the default user
      const roots = buildRoots(entries);
      let client = await context.getGoogleClient();
      let hierarchy = await client.getItemsFromId(id, roots);
      if (hierarchy.length) {
        const { id: rootId } = hierarchy[hierarchy.length - 1];
        ret = entries.filter(({ gdriveId }) => gdriveId === rootId);
        log.info('%j', {
          discover: {
            id,
            count: ret.length,
            client: true,
          },
        });
        return ret;
      }

      // if still nothing found. find using the entries with a custom user
      ret = null;
      const customUsers = this.#getCustomUsers(entries);
      await processQueue(customUsers, async ({ project, contentBusId }) => {
        if (!ret) {
          try {
            // eslint-disable-next-line no-await-in-loop
            client = await context.getGoogleClient(contentBusId);
            // eslint-disable-next-line no-await-in-loop
            hierarchy = await client.getItemsFromId(id, roots);
            if (hierarchy.length) {
              const { id: rootId } = hierarchy[hierarchy.length - 1];
              ret = entries.filter(({ gdriveId }) => gdriveId === rootId);
              log.info('%j', {
                discover: {
                  id,
                  count: ret.length,
                  client: true,
                  project,
                },
              });
            }
          } catch (e) {
            log.info(`Unable to get items from id: ${url} in ${project}: ${e.message}`);
          }
        }
      }, 3);
      return ret ?? [];
    } catch (e) {
      log.info(`Unable to get items from id: ${url}: ${e.message}`);
      return [];
    }
  }

  /**
   * Extract some data from a URL to store in the inventory.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {URL} url url to extract data from
   * @param {import('../inventory.js').InventoryEntry} entry entry
   * @returns object that contains additional entries to store in inventory
   */
  async extract(context, url, entry) {
    const match = url.pathname.match(/\/.*\/folders\/([^?/]+)$/);
    if (!match) {
      return;
    }

    // eslint-disable-next-line no-param-reassign
    [, entry.gdriveId] = match;
    if (!entry.contentBusId) {
      return;
    }

    // do not search for custom users in org/sites that
    // are not listed in env.HLX_CUSTOM_GOOGLE_USERS
    if (!this.customUserProjects.some((project) => project.match(entry))) {
      return;
    }

    const { code: codeBucket, content: contentBucket } = context.attributes.bucketMap;
    const plugin = await getCachePlugin({
      log: context.log,
      contentBusId: entry.contentBusId,
      readOnly: true,
      codeBucket,
      contentBucket,
    }, 'google');
    if (!plugin.key.startsWith('default/.helix-auth/')) {
      // eslint-disable-next-line no-param-reassign
      entry.customUser = true;
    }
  }

  /**
   * Test whether this class can handle an URL
   *
   * @param {URL} url url to match
   * @param {Inventory} inventory
   * @returns true if this class can handle the URL
   */
  static match(url, inventory) {
    return inventory.getHostType(url.hostname) === 'google' || url.hostname.match(/^.*\.google\.com$/);
  }
}
