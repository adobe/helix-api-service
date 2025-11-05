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
import { OneDrive } from '@adobe/helix-onedrive-support';
import { sanitizeName, splitByExtension, editDistance } from '@adobe/helix-shared-string';
import { getSourceLastModified } from '../support/onedrive.js';
import { sleep } from '../support/utils.js';
import { Forest } from './Forest.js';

export class OneDriveForest extends Forest {
  constructor(log, drive, retryDelay) {
    super(log);
    this.drive = drive;
    this.retryDelay = retryDelay;
  }

  /**
   * @param rootItem
   * @param rootPath
   * @param relPath
   * @return {Promise<Array<DriveItem>|null>}
   */
  async listFolder(rootItem, rootPath, relPath) {
    const { log, drive, retryDelay } = this;
    const uri = `/drives/${rootItem.parentReference.driveId}/items/${rootItem.id}:${relPath}`;
    log.debug(`listing children for ${uri}`);
    const query = {
      $top: 999,
      $select: 'name,parentReference,file,id,size,webUrl,lastModifiedDateTime',
    };
    let itemList = [];
    let retry;
    do {
      retry = 0;
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await drive.listChildren(rootItem, relPath, query);
        itemList = itemList.concat(result.value);
        if (result['@odata.nextLink']) {
          const nextLink = new URL(result['@odata.nextLink']);
          query.$skiptoken = nextLink.searchParams.get('$skiptoken');
          log.debug(`fetching more children with skiptoken ${query.$skiptoken}`);
        } else {
          query.$skiptoken = null;
        }
      } catch (e) {
        log.debug(`listing children for ${uri} failed: ${e.statusCode}`);
        if (e.statusCode === 429) {
          retry = e.rateLimit?.retryAfter || 1;
          log.info(`rate limit exceeded. sleeping for ${retry}s`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(retry * retryDelay);
        } else if (e.statusCode === 404) {
          return null;
        } else {
          throw e;
        }
      }
    } while (query.$skiptoken || retry);

    // console.log(JSON.stringify(itemList, null, 2));

    // sanitize names and filter out duplicates.
    const map = new Map();
    for (const item of itemList) {
      if (item.name === '.helix') {
        // eslint-disable-next-line no-continue
        continue;
      }
      const [itemName, ext] = splitByExtension(item.name);
      const name = sanitizeName(itemName);
      item.sanitizedName = ext ? `${name}.${ext}` : name;
      if (item.sanitizedName === 'index.docx') {
        item.path = `${rootPath}${relPath}/`;
        item.resourcePath = `${item.path}index.md`;
        item.ext = '.md';
      } else if (ext === 'docx') {
        item.path = `${rootPath}${relPath}/${name}`;
        item.resourcePath = `${item.path}.md`;
        item.ext = '.md';
      } else if (ext === 'xlsx') {
        item.path = `${rootPath}${relPath}/${name}.json`;
        item.resourcePath = item.path;
        item.ext = '.json';
      } else if (ext === 'md') {
        // ignore markdown files
        // eslint-disable-next-line no-continue
        continue;
      } else {
        item.path = `${rootPath}${relPath}/${item.sanitizedName}`;
        item.resourcePath = item.path;
        item.ext = ext;
      }
      item.fuzzyDistance = editDistance(item.sanitizedName, itemName);
      const existing = map.get(item.sanitizedName);
      if (!existing || existing.fuzzyDistance > item.fuzzyDistance) {
        map.set(item.sanitizedName, item);
      }
    }
    log.info(`loaded ${map.size} children from ${uri}`);
    return Array.from(map.values());
  }
}

/**
 * Fetches file data from the external source.
 *
 * The paths can specify the files that should be included in the list.
 * If a path ends with `/*` its entire subtree is retrieved.
 *
 * @type {import('./contentproxy.js').FetchList}
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string[]} paths
 * @param {ProgressCallback} progressCB
 * @returns {Promise<ResourceInfo[]>} the list of resources
 */
export async function list(context, info, paths, progressCB) {
  const { config: { content: { contentBusId, source } }, log } = context;
  const { org, site } = info;

  const client = await context.getOneDriveClient(org, site, {
    contentBusId,
    tenant: source.tenantId,
    logFields: {
      project: `${org}/${site}`,
      operation: `${info.route} *`,
    },
  });

  log.debug(`resolving sharelink to ${source.url}`);
  const rootItem = await client.getDriveItemFromShareLink(source.url);

  const retryDelay = /* c8 ignore next */ context.attributes.retryDelay || 1000;
  const forest = new OneDriveForest(log, client, retryDelay);
  const itemList = await forest.generate(rootItem, paths, progressCB);

  return itemList.map((item) => {
    if (item.status) {
      return item;
    }
    const location = OneDrive.driveItemToURL(item).href;
    const ret = {
      path: item.path,
      resourcePath: item.resourcePath,
      source: {
        name: item.name,
        contentType: item.file?.mimeType || 'application/octet-stream',
        location,
        size: item.size || 0,
        type: 'onedrive',
      },
    };
    const lastModified = getSourceLastModified(item);
    if (lastModified !== null) {
      ret.source.lastModified = lastModified;
    }
    return ret;
  });
}
