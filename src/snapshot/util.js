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

/**
 * Get array of paths that are unique and contain the least specific wildcards.
 * @param {string[]} paths
 * @returns {string[]}
 */
export function resolveUniquePaths(paths) {
  let wildcardRoots = [];
  const uniquePaths = new Set();

  paths.forEach((ppath) => {
    // ensure path is string starting with /
    let path = String(ppath);
    if (!path.startsWith('/')) {
      path = `/${path}`;
    }

    if (path.endsWith('/*')) {
      // check if wildcard roots already contains a less specific wildcard
      const root = path.slice(0, -2);
      const lessSpecific = wildcardRoots.find((p) => root.startsWith(p));
      if (!lessSpecific) {
        // this may be less specific, so filter existing before adding it
        wildcardRoots = wildcardRoots.filter((p) => !p.startsWith(root));
        // also filter uniquePaths, since they may now be redundant
        uniquePaths.forEach((p) => {
          if (p.startsWith(root)) {
            uniquePaths.delete(p);
          }
        });
        wildcardRoots.push(root);
      }
    } else {
      // check if any wildcard root already covers this path
      const covered = wildcardRoots.find((p) => path.startsWith(p));
      if (!covered) {
        uniquePaths.add(path);
      }
    }
  });
  wildcardRoots.forEach((root) => {
    uniquePaths.add(`${root}/*`);
  });
  return [...uniquePaths];
}
