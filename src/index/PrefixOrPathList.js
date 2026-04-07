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
 * Utility class to represent a list of prefixes and/or paths.
 * @class
 */
export class PrefixOrPathList {
  /** @type {string[]} */
  prefixes = [];

  /** @type {string[]} */
  paths = [];

  constructor(prefixesOrPaths) {
    prefixesOrPaths.forEach(({ prefix, path }) => {
      if (prefix) {
        this.prefixes.push(prefix);
      } else {
        this.paths.push(path);
      }
    });
  }

  /**
   * Check if a path is contained in the list of prefixes or paths.
   *
   * @param {string} path path
   * @returns {boolean} true if the path is contained in the list, false otherwise
   */
  contains(path) {
    if (this.prefixes.some((prefix) => path.startsWith(prefix))) {
      return true;
    }
    return this.paths.indexOf(path) !== -1;
  }
}
