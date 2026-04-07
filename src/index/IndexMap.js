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
import crypto from 'crypto';

/**
 * @typedef IndexRecord
 * @property {boolean} live whether that record is live
 * @property {object} indexHash hash of index record, keyed by index name
 */

/**
 * Represents a map of index records, keyed by path.
 * @class
 */
export class IndexMap {
  /** @type {Map<string, IndexRecord>} */
  map;

  constructor() {
    this.map = new Map();
  }

  /**
   * Hash an existing record to easily compare it against the live version
   *
   * @param {object} row existing row
   * @returns {string} MD5 hash of rocerd
   */
  static hash(row) {
    const hash = crypto.createHash('md5');
    Object.keys(row)
      .sort((k0, k1) => k0.localeCompare(k1))
      .forEach((k) => hash.update(k).update('\n').update(String(row[k])).update('\n'));
    return hash.digest().toString('hex');
  }

  /**
   * Add a record to the map for a path that is currently live.
   *
   * @param {string} webPath web path
   */
  addLive(webPath) {
    const { map } = this;

    map.set(webPath, { live: true, indexHash: {} });
  }

  /**
   * Add a record to the map for a path that is currently indexed.
   *
   * @param {string} name index name
   * @param {object} row row from index target
   */
  addIndexed(name, row) {
    const { map } = this;

    let indexRecord = map.get(row.path);
    if (!indexRecord) {
      // if a resource is indexed but not in the content bus, mark it as non-live.
      // this can be deleted later
      indexRecord = { live: false, indexHash: {} };
      map.set(row.path, indexRecord);
    }
    // remember the hashed record for that index
    indexRecord.indexHash[name] = IndexMap.hash(row);
  }

  entries() {
    return this.map.entries();
  }
}
