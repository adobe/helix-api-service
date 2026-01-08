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
import { processPrefixedPaths } from '../support/utils.js';

export /* abstract */ class Forest {
  constructor(log) {
    this.log = log;
  }

  // eslint-disable-next-line no-unused-vars,class-methods-use-this
  async listFolder(root, rootPath, relPath) {
    throw new Error('abstract method');
  }

  async generate(rootItem, paths, progressCB) {
    const itemList = new Map();

    const sPaths = processPrefixedPaths(paths);
    const folderPaths = [];
    const filePaths = [];
    for (const { prefix, path } of sPaths) {
      if (prefix) {
        folderPaths.push({
          rootItem,
          rootPath: '',
          path: prefix.substring(0, prefix.length - 1),
        });
      }
      if (path) {
        filePaths.push(path);
      }
    }

    // process folders
    while (folderPaths.length) {
      // eslint-disable-next-line no-await-in-loop
      if (progressCB && !await progressCB({ total: itemList.size })) {
        // aborting the listing returns empty list
        return [];
      }
      const folder = folderPaths.shift();
      const path = `${folder.rootPath}${folder.path}/*`;
      try {
        // eslint-disable-next-line no-await-in-loop
        const items = await this.listFolder(folder.rootItem, folder.rootPath, folder.path);
        if (!items) {
          // mark folder as not found
          itemList.set(path, { status: 404, path });
        } else {
          for (const item of items) {
            if (item.file) {
              itemList.set(item.path, item);
            } else {
              folderPaths.push({
                rootItem: item,
                rootPath: item.path,
                path: '',
              });
            }
          }
        }
      } catch (e) {
        itemList.set(path, {
          status: 500,
          error: String(e),
          path,
        });
      }
    }

    // process individual paths
    const folders = {};
    while (filePaths.length) {
      // eslint-disable-next-line no-await-in-loop
      if (progressCB && !await progressCB({ total: itemList.length })) {
        // aborting the listing returns empty list
        return [];
      }
      const path = filePaths.shift();
      const idx = path.lastIndexOf('/');
      const folderPath = path.substring(0, idx);
      let items = folders[folderPath];
      if (!items) {
        try {
          // eslint-disable-next-line no-await-in-loop
          items = await this.listFolder(rootItem, '', folderPath);
          if (!items) {
            const infoPath = `${folderPath}/*`;
            itemList.set(infoPath, { status: 404, path: infoPath });
            items = [];
          }
        } catch (e) {
          const infoPath = `${folderPath}/*`;
          itemList.set(infoPath, {
            status: e.$metadata.httpStatusCode ?? 500,
            path: infoPath,
            error: String(e),
          });
          items = [];
        }
        folders[folderPath] = items;
      }
      const item = items.find((it) => it.path === path && it.file);
      if (item) {
        itemList.set(path, item);
      } else {
        itemList.set(path, {
          path,
          status: 404,
        });
      }
    }

    // validate the individual files
    for (const path of paths) {
      if (!path.endsWith('/*')) {
        if (!itemList.has(path)) {
          itemList.set(path, {
            path,
            status: 404,
          });
        }
      }
    }

    // sort by path
    const list = [...itemList.values()];
    list.sort((i0, i1) => i0.path.localeCompare(i1.path));
    return list;
  }
}
