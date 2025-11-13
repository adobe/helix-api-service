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
import { isDeepStrictEqual } from 'util';

/**
 * Each entry represents a site config. org/site must be unique.
 *
 * @typedef InventoryEntry
 * @property {string} org
 * @property {string} site
 * @property {string} codeBusId owner/repo of the code
 * @property {string} contentSourceUrl
 * @property {string} contentBusId
 * @property {string} routes
 * @property {string} originalSite
 * @property {string} [gdriveId]
 * @property {string} [sharepointSite]
 *
 * @typedef InventoryData
 * @property {InventoryEntry[]} entries
 * @property {object} hostTypes Map of hostname to source type,
 *           eg: "adobe.sharepoint.com": "sharepoint"
 */

/**
 * Inventory path in content bus.
 */
const INVENTORY_PATH = '/default/inventory.json';

/**
 * Simple inventory class
 */
export class Inventory {
  /**
   * @type {InventoryData}
   */
  #data = {
    entries: [],
    hostTypes: {},
  };

  /**
   * @type {import('@adobe/helix-shared-storage').Bucket}
   */
  #bucket;

  /**
   * @type {any}
   */
  #log;

  /**
   * modified flag
   */
  #modified;

  /**
   * @constructs Inventory
   * @param {import('@adobe/helix-shared-storage').Bucket} bucket bucket
   * @param {any} log logger
   */
  constructor(bucket, log) {
    this.#log = log;
    this.#bucket = bucket;
    this.#modified = true;
  }

  /**
   * traverses all entries and creates a map from hostname to matcher
   */
  #indexHostTypes() {
    const types = {};
    for (const entry of this.#data.entries) {
      if (entry.sharepointSite) {
        const { hostname } = new URL(entry.sharepointSite);
        types[hostname] = 'sharepoint';
      } else if (entry.gdriveId) {
        const { hostname } = new URL(entry.contentSourceUrl);
        types[hostname] = 'google';
      }
    }
    this.#data.hostTypes = types;
  }

  /**
   * @return {Promise<boolean>}
   */
  async load() {
    const buf = await this.#bucket.get(INVENTORY_PATH);
    if (!buf) {
      return false;
    }
    const data = JSON.parse(buf);
    if (Array.isArray(data)) {
      // backward compat
      this.#data = {
        entries: data,
        hostTypes: {},
      };
      this.#indexHostTypes();
    } else {
      this.#data = data;
    }
    this.#modified = false;
    return true;
  }

  /**
   * @return {Promise<void>}
   */
  async save() {
    if (this.#modified) {
      this.#indexHostTypes();
      await this.#bucket.put(INVENTORY_PATH, JSON.stringify(this.#data), 'application/json');
      this.#modified = false;
    }
  }

  /**
   * @return {InventoryEntry[]}
   */
  entries() {
    return this.#data.entries;
  }

  /**
   * Adds an entry quickly, assumes that it doesn't exist yet
   * @param {InventoryEntry} entry
   */
  appendEntry(entry) {
    this.#data.entries.push(entry);
    this.#modified = true;
  }

  /**
   * Finds an entry in the inventory
   * @param org
   * @param site
   * @returns {InventoryEntry|undefined}
   */
  findEntry(org, site) {
    return this.#data.entries.find((e) => e.org === org && e.site === site);
  }

  /**
   * Adds or updates an entry in the inventory
   * @param {InventoryEntry} entry
   * @returns {boolean} true if an entry was added, otherwise false
   */
  addEntry(entry) {
    const { org, site } = entry;
    const index = this.#data.entries.findIndex((e) => e.org === org && e.site === site);
    if (index !== -1) {
      const old = this.#data.entries[index];
      if (isDeepStrictEqual(old, entry)) {
        this.#log.info(`Kept identical entry for ${org}/${site} in inventory`);
        return false;
      }
      this.#data.entries[index] = entry;
      this.#log.info(`Replaced entry for ${org}/${site} to inventory`);
    } else {
      this.#data.entries.push(entry);
      this.#log.info(`Added entry for ${org}/${site} to inventory`);
    }
    this.#modified = true;
    return true;
  }

  /**
   * Removes an entry from the inventory
   * @param {string} org
   * @param {string} site
   * @return {InventoryEntry|null}
   */
  removeEntry(org, site) {
    const { entries } = this.#data;
    const index = entries.findIndex((e) => e.org === org && e.site === site);
    if (index !== -1) {
      this.#log.info(`Deleted entry for ${org}/${site} in inventory`);
      this.#modified = true;
      return entries.splice(index, 1)[0];
    }
    return null;
  }

  /**
   * @param {string} host
   * @return {string}
   */
  getHostType(host) {
    return this.#data.hostTypes[host];
  }
}
