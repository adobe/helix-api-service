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
 * Matcher that filters inventory entries against github url.
 */
export default class GithubMatcher {
  /**
   * Find the inventory entries that have the given github URL.
   *
   * @param {URL} url google document or spreadsheet
   * @param {Inventory} inventory inventory of entries
   */
  // eslint-disable-next-line class-methods-use-this
  filter(url, inventory) {
    const segs = url.pathname.split('/');
    const [, owner, repo] = segs;
    const codeBusId = `${owner}/${repo}`;
    return inventory.entries().filter((entry) => entry.codeBusId === codeBusId);
  }

  /**
   * Test whether this class can handle an URL
   *
   * @param {URL} url url to match
   * @returns true if this class can handle the URL
   */
  static match(url) {
    return url.host === 'github.com';
  }
}
