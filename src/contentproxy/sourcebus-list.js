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
import { sanitizeName, splitByExtension, editDistance } from '@adobe/helix-shared-string';
import { GoogleClient } from '@adobe/helix-google-support';
import { Forest } from './Forest.js';
import {HelixStorage} from "@adobe/helix-shared-storage";
import {getS3Key} from "../source/utils.js";
import {Response} from "@adobe/fetch";
import {createErrorResponse} from "../contentbus/utils.js";
import {validateSource} from "./sourcebus-utils.js";
import {errorResponse} from "../support/utils.js";
import {error} from "./errors.js";

export class SourceForest extends Forest {
  constructor(ctx) {
    super(ctx.log);
    this.ctx = ctx;
  }

  /**
   * List items below a root item.
   * @returns {Promise<object[]>}
   */
  async listFolder(rootItem, rootPath, relPath) {






    const bucket = HelixStorage.fromContext(context).sourceBus();
    const { org, site, rawPath: path } = info;

    try {
      validateFolderPath(path);
      const key = getS3Key(org, site, path);
      const list = await bucket.list(key, { shallow: true, includePrefixes: true });

      // Check the length of the raw filesList. This will include the
      // directory marker files. So a directory with just a marker file
      // is reported as empty, but without anything is reported as not found.
      if (list.length === 0) {
        return new Response('', { status: 404 });
      }

      if (headRequest) {
        return new Response('', { status: 200 });
      }

      const output = transformList(list);
      const headers = {
        'Content-Type': 'application/json',
      };
      return new Response(JSON.stringify(output), { status: 200, headers });
    } catch (e) {
      const opts = { e, log };
      opts.status = e.$metadata?.httpStatusCode;
      return createErrorResponse(opts);
    }





    const { log, client } = this;
    const parentPath = `${rootPath}${relPath}`;
    log.debug(`listing children for ${rootItem.id}:${parentPath}`);
    let folderId = rootItem.id;
    if (relPath) {
      const hierarchy = await client.getItemsFromPath(rootItem.id, relPath, 'application/vnd.google-apps.folder');
      if (!hierarchy.length) {
        return [];
      }
      folderId = hierarchy[0].id;
    }
    const opts = {
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 1000,
    };

    let itemList = [];
    do {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await client.drive.files.list(opts);
      if (data.nextPageToken) {
        opts.pageToken = data.nextPageToken;
      } else {
        opts.pageToken = null;
      }
      log.debug(`fetched ${data.files.length} items below ${folderId}. nextPageToken=${opts.pageToken ? '****' : 'null'}`);
      itemList = itemList.concat(data.files);
    } while (opts.pageToken);

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
      item.file = true;
      if (item.sanitizedName === 'index') {
        item.path = `${parentPath}/`;
        item.resourcePath = `${parentPath}/index.md`;
        item.ext = '.md';
      } else if (item.mimeType === GoogleClient.TYPE_DOCUMENT) {
        item.path = `${parentPath}/${name}`;
        item.resourcePath = `${item.path}.md`;
        item.ext = '.md';
      } else if (item.mimeType === GoogleClient.TYPE_SPREADSHEET) {
        item.path = `${parentPath}/${name}.json`;
        item.resourcePath = item.path;
        item.ext = '.json';
      } else if (item.mimeType === 'application/vnd.google-apps.folder') {
        delete item.file;
        item.path = `${parentPath}/${name}`;
        item.resourcePath = item.path;
      } else if (ext === 'md') {
        // ignore markdown files
        // eslint-disable-next-line no-continue
        continue;
      } else {
        item.path = `${parentPath}/${item.sanitizedName}`;
        item.resourcePath = item.path;
        item.ext = ext;
      }
      item.fuzzyDistance = editDistance(item.sanitizedName, itemName);
      item.size = Number.parseInt(item.size, 10);
      const existing = map.get(item.sanitizedName);
      if (!existing || existing.fuzzyDistance > item.fuzzyDistance) {
        map.set(item.sanitizedName, item);
      }
    }
    log.info(`loaded ${map.size} children from ${rootItem.id}:${parentPath}`);
    return Array.from(map.values());
  }
}
/**
 * Fetches file data from the external source.
 * the paths can specify the files that should be included in the list. if a path ends with `/*`
 * its entire subtree is retrieved.
 *
 * @type {import('./contentproxy.js').FetchList}
 * @param {import('../support/AdminContext').AdminContext} ctx context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string[]} paths
 * @param {ProgressCallback} progressCB
 * @returns {Promise<ResourceInfo[]>} the list of resources
 */
export async function list(ctx, paths, progressCB) {
  const { config: { content: { source } }, log } = ctx;
  const sourceUrl = new URL(source.url);

  // extract org and site from url.pathname, format: https://api.aem.live/<org>/sites/<site>/source
  // e.g. /adobe/sites/foo/source
  const pathMatch = sourceUrl.pathname.match(/^\/([^/]+)\/sites\/([^/]+)\/source$/);
  if (!pathMatch) {
    const { message } = error(
      'Source url must be in the format: https://api.aem.live/<org>/sites/<site>/source. Got: $1',
      sourceUrl.href,
    );
    throw new StatusCodeError(400, message);
  } else {
    const [, org, site] = pathMatch; // eslint-disable-line prefer-destructuring
    if (org !== info.org || site !== info.site) {
      ret.error = errorResponse(log, 400, error(
        'Source bus is not allowed for org: $1, site: $2',
        org,
        site,
      ));
    }
  }

  // for now, only allow source bus from the same org and site




  const forest = new SourceForest(ctx);
  const itemList = await forest.generate(source, paths, progressCB);

  return itemList.map((item) => {
    if (item.status) {
      return item;
    }
    return {
      path: item.path,
      resourcePath: item.resourcePath,
      source: {
        name: item.name,
        id: item.id,
        mimeType: item.mimeType || 'application/octet-stream',
        lastModified: Date.parse(item.modifiedTime),
        size: item.size,
        type: 'source',
      },
    };
  });
}
