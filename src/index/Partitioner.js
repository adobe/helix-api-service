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
 * Default maximum number of indices to collect in one chunk.
 */
const MAX_INDICES = 10;

/**
 * Default maximum number of updates to collect in one chunk.
 */
const MAX_UPDATES = 100;

/**
 * @typedef ProjectUpdates
 * @property {string} key key
 * @property {string} owner owner
 * @property {string} repo repo
 * @property {Object[]} updates updates
 */

/**
 * Group updates by index name.
 *
 * @param {Object[]} updates updates containing an index value
 * @returns {Map} updates keyed by index name
 */
function groupUpdatesByIndex(updates) {
  return updates.reduce((map, update) => {
    if (!map.has(update.index)) {
      map.set(update.index, []);
    }
    map.get(update.index).push(update);
    return map;
  }, new Map());
}

/**
 * Partitions updates into chunks that will not contain more than a configurable
 * amount of indices and updates.
 */
export class Partitioner {
  /** @private */
  #key;

  /** @private */
  #owner;

  /** @private */
  #repo;

  /** @private */
  #chunks;

  /** @private */
  #current;

  /** @private */
  #maxIndices;

  /** @private */
  #maxUpdates;

  constructor(key, owner, repo, maxIndices = MAX_INDICES, maxUpdates = MAX_UPDATES) {
    this.#key = key;
    this.#owner = owner;
    this.#repo = repo;
    this.#maxIndices = maxIndices;
    this.#maxUpdates = maxUpdates;

    this.#chunks = [];

    this.#pushChunk();
  }

  /**
   * Partition a collection of project updates into chunks so every chunk can be processed
   * by the indexer completely before the service times out.
   *
   * @param {ProjectUpdates} project project updates
   * @returns {ProjectUpdates[]} updates to send
   */
  static partition(project) {
    if (project.updates.length === 0) {
      return [project];
    }
    const [{ type }] = project.updates;
    if (type !== 'onedrive') {
      return [project];
    }
    const partitioner = new Partitioner(project.key, project.owner, project.repo);
    for (const updates of groupUpdatesByIndex(project.updates).values()) {
      partitioner.feed(updates);
    }
    return partitioner.chunks;
  }

  /**
   * Feed another set of updates for a new index.
   *
   * @param {Object[]} updates updates
   */
  feed(updates) {
    let chunk = this.#chunks[this.#current];
    if (chunk.indices >= this.#maxIndices || chunk.updates.length >= this.#maxUpdates) {
      chunk = this.#pushChunk();
    }

    const avail = this.#maxUpdates - chunk.updates.length;
    const count = Math.min(avail, updates.length);
    chunk.updates.push(...updates.slice(0, count));
    chunk.indices += 1;

    const remaining = updates.slice(count);
    for (let i = 0; i < remaining.length; i += this.#maxUpdates) {
      this.#pushChunk(remaining.slice(i, i + this.#maxUpdates));
    }
  }

  /**
   * Push another chunk to the list of chunks.
   *
   * @param {Object[]} updates updates
   * @returns new chunk
   */
  #pushChunk(updates = []) {
    this.#chunks.push({
      key: this.#key,
      owner: this.#owner,
      repo: this.#repo,
      updates,
      indices: updates.length ? 1 : 0,
    });
    this.#current = this.#chunks.length - 1;
    return this.#chunks[this.#current];
  }

  /**
   * Return array of chunks that satisfy conditions
   *
   * @returns chunks of updates
   */
  get chunks() {
    return this.#chunks.map(({
      key, owner, repo, updates,
    }) => ({
      key, owner, repo, updates,
    }));
  }
}
