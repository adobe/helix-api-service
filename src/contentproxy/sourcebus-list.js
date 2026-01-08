/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { splitByExtension } from '@adobe/helix-shared-string';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { basename, dirname } from 'path';
import { Forest } from './Forest.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { validateSource } from './sourcebus-utils.js';

export class SourceForest extends Forest {
  constructor(ctx, info) {
    super(ctx.log);
    this.ctx = ctx;
    this.bucket = HelixStorage.fromContext(ctx).sourceBus();
    this.org = info.org;
    this.site = info.site;
  }

  /**
   * List items below a root item.
   * @returns {Promise<object[]>}
   */
  async listFolder(source, rootPath, relPath) {
    const key = `${this.org}/${this.site}${relPath}`;
    const listing = await this.bucket.list(key);
    return listing.map((item) => {
      /*
        "key": "org/site/documents/index.html",
        "lastModified": "2025-01-01T12:34:56.000Z",
        "contentLength": 32768,
        "contentType": "text/html",
        "path": "/index.html"
       */
      const path = `${rootPath}${relPath}${item.path}`;
      const name = basename(item.path);
      if (name === '.props') {
        return null;
      }
      const [baseName, ext] = splitByExtension(path); // eg: /documents/index , .html
      const ret = {
        ...item,
        path,
        file: true,
        resourcePath: path,
        name,
        ext,
      };
      if (name === 'index.html') {
        ret.path = `${dirname(path)}/`;
        ret.resourcePath = `${baseName}.md`;
        ret.ext = '.md';
      } else if (ext === 'html') {
        ret.path = baseName;
        ret.resourcePath = `${baseName}.md`;
        ret.ext = '.md';
      }
      return ret;
    }).filter((item) => !!item);
  }
}
/**
 * Fetches file data from the external source.
 * the paths can specify the files that should be included in the list. if a path ends with `/*`
 * its entire subtree is retrieved.
 *
 * @type {import('./contentproxy.js').FetchList}
 * @param {import('../support/AdminContext').AdminContext} ctx context
 * @param {PathInfo} info
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string[]} paths
 * @param {ProgressCallback} progressCB
 * @returns {Promise<ResourceInfo[]>} the list of resources
 */
export async function list(ctx, info, paths, progressCB) {
  const { config: { content: { source } } } = ctx;
  const { error } = await validateSource(ctx, info);
  if (error) {
    throw new StatusCodeError(error.headers.get('x-error'), error.status);
  }

  const forest = new SourceForest(ctx, info);
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
        contentType: item.contentType,
        lastModified: Date.parse(item.lastModified),
        size: item.contentLength,
        type: 'source',
      },
    };
  });
}
