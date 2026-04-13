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

import { Response } from '@adobe/fetch';
import { HelixStorage } from '@adobe/helix-shared-storage';

// @ts-check

const SERIALIZED_FIELDS = ['id', 'created', 'lastModified', 'lastUpdated', 'locked', 'title', 'description', 'metadata', 'review', 'fromLive'];

/**
 * @typedef {import('../support/AdminContext').AdminContext} AdminContext
 * @typedef {import('../support/RequestInfo').RequestInfo} RequestInfo
 * @typedef {import('@adobe/helix-shared-storage').Bucket} Bucket
 */

export class Manifest {
  /**
   * property names that can be updated on the manifest
   * @type {string[]}
   */
  static CUSTOM_PROPERTIES = [
    'title',
    'description',
    'metadata',
  ];

  /**
   * property size limits, in bytes
   * @type {Record<string, number>}
   */
  static CUSTOM_PROPERTY_LIMITS = {
    title: 4e3,
    description: 16e3,
    metadata: 512e3,
    default: 64e3,
  };

  /**
   * the s3 key
   * @type {string}
   */
  #key;

  /**
   * content storage
   * @type {Bucket}
   */
  #storage;

  /**
   * true if manifest was modified
   * @type {boolean}
   */
  #isModified;

  /**
   * whether the manifest exists in storage yet
   * @type {boolean}
   */
  #exists = false;

  /**
   * Resources touched since `init` or last call to `markResourcesPurged`.
   * Does not include `/.snapshots/{id}` prefix.
   * @type {Set<string>}
   */
  #resourcesToPurge = new Set();

  /**
   * the snapshot id
   * @type {string}
   */
  id;

  /**
   * the title
   * @type {string}
   */
  title;

  /**
   * the description
   * @type {string}
   */
  description;

  /**
   * the creation time
   * @type {string}
   */
  created;

  /**
   * last time this manifest was updated
   * @type {string}
   */
  lastModified;

  /**
   * last time a resource was added to this snapshot
   * @type {string}
   */
  lastUpdated;

  /**
   * locked time
   * @type {string|undefined}
   */
  locked;

  /**
   * review status
   * @type {'requested'|'rejected'|undefined}
   */
  review;

  /**
   * whether the snapshot is from live partition
   * @type {boolean}
   */
  fromLive;

  /**
   * Resources in snapshot
   * { path => { path, status } }
   * @type {Map<string, { path: string; status: number;}>}
   */
  resources = new Map();

  /**
   * Initializes the manifest from the context. Caches the manifest in context.attributes.
   * @param {AdminContext} context the context
   * @param {string} snapshotId snapshot id
   * @returns {Promise<Manifest>}
   */
  static async fromContext(context, snapshotId) {
    if (!context.attributes.snapshotManifest) {
      context.attributes.snapshotManifest = await new Manifest().init(context, snapshotId);
    }
    return context.attributes.snapshotManifest;
  }

  /**
   * Initializes the manifest by fetching it from the content bus.
   *
   * @param {AdminContext} context the context
   * @param {string} snapshotId snapshot id
   * @returns {Promise<Manifest>} this manifest.
   */
  async init(context, snapshotId) {
    const { contentBusId } = context;
    this.id = snapshotId;
    this.#key = `${contentBusId}/preview/.snapshots/${this.id}/.manifest.json`;
    this.#storage = HelixStorage.fromContext(context).contentBus();

    const data = await this.#storage.get(this.#key);
    if (data) {
      const json = JSON.parse(data.toString('utf-8'));
      for (const key of SERIALIZED_FIELDS) {
        if (key in json) {
          this[key] = json[key];
        }
      }
      if (json.resources) {
        this.resources = new Map(
          json.resources.map(
            (resource) => [resource.path, { ...resource, status: resource.status ?? 200 }],
          ),
        );
      }
    }
    this.#exists = !!this.created;
    if (!this.#exists && [true, 'true'].includes((context.data ?? {}).fromLive)) {
      this.fromLive = true;
    }
    return this;
  }

  get exists() {
    return this.#exists;
  }

  get resourcesNeedPurge() {
    return this.#resourcesToPurge.size > 0;
  }

  /**
   * Resource paths that need to be purged from cache.
   * Includes `/.snapshots/{id}` prefix.
   * Does not include `.manifest.json`.
   * @type {string[]}
   */
  get resourcesToPurge() {
    return [...this.#resourcesToPurge].map((p) => `/.snapshots/${this.id}${p}`);
  }

  /**
   * Stores the manifest if modified
   * @returns {Promise<boolean>} resolves to `true` if manifest was stored
   */
  async store() {
    if (!this.#isModified && this.#exists) {
      return false;
    }
    if (!this.#exists) {
      const mod = new Date().toISOString();
      this.created = mod;
      this.lastModified = mod;
    }
    await this.#storage.put(this.#key, JSON.stringify(this), 'application/json');
    const needsPurge = this.#isModified;
    this.#isModified = false;
    this.#exists = true;
    return needsPurge;
  }

  /**
   * @returns {Promise<boolean>} `true` if the manifest was deleted
   */
  async delete() {
    if (!this.#exists || this.resources.size > 0) {
      return false;
    }
    await this.#storage.remove(this.#key);
    this.#exists = false;
    return true;
  }

  touch(now = new Date()) {
    this.lastModified = now.toISOString();
    if (!this.created) {
      this.created = this.lastModified;
    }
    this.#isModified = true;
  }

  markUpdated(now = new Date()) {
    this.lastUpdated = now.toISOString();
    this.touch(now);
  }

  markResourcesPurged() {
    this.#resourcesToPurge.clear();
  }

  setReviewState(state) {
    this.review = state;
    this.touch(new Date());
  }

  /**
   * @param {boolean} value
   * @returns {boolean} `true` if the lock state was changed
   */
  lock(value) {
    const enable = !!value;
    if (!!this.locked === enable) {
      return false;
    }
    const now = new Date();
    if (enable) {
      this.locked = now.toISOString();
    } else {
      delete this.locked;
    }
    this.touch(now);
    return true;
  }

  /**
   * Set custom property.
   * @param {string} name
   * @param {string} value
   * @throws {Error} if operation is invalid due to key or property size
   */
  setProperty(name, value) {
    if (!Manifest.CUSTOM_PROPERTIES.includes(name)) {
      throw Error(`setting ${name} is not supported.`);
    }

    /* c8 ignore next */
    const limit = Manifest.CUSTOM_PROPERTY_LIMITS[name] || Manifest.CUSTOM_PROPERTY_LIMITS.default;
    const size = typeof value === 'object' ? JSON.stringify(value).length : String(value).length;
    if (size > limit) {
      throw Error(`property "${name}" exceeds ${(limit / 1000).toFixed(0)}kb limit.`);
    }

    if (value) {
      if (this[name] !== value) {
        this[name] = value;
        this.touch(new Date());
      }
    } else if (this[name] !== undefined) {
      delete this[name];
      this.touch(new Date());
    }
  }

  /**
   * @param {string} path
   * @param {number} [status=200]
   */
  addResource(path, status = 200) {
    if (!this.resources.has(path)) {
      this.resources.set(path, { path, status });
      this.touch(new Date());
    } else {
      const existing = this.resources.get(path);
      if (existing.status !== status) {
        existing.status = status;
        this.touch(new Date());
      }
      // only need to purge if already existed
      this.#resourcesToPurge.add(path);
    }
  }

  /**
   * @param {string} path
   * @param {boolean} [forcePurge] for orphaned resources
   */
  removeResource(path, forcePurge) {
    if (this.resources.has(path)) {
      this.resources.delete(path);
      this.touch(new Date());
      this.#resourcesToPurge.add(path);
    } else if (forcePurge) {
      this.#resourcesToPurge.add(path);
    }
  }

  toJSON() {
    const obj = {};
    for (const key of SERIALIZED_FIELDS) {
      if (this[key] !== undefined) {
        obj[key] = this[key];
      }
    }
    obj.resources = [...this.resources.values()].sort((a, b) => a.path.localeCompare(b.path));
    return obj;
  }

  toResponse(info) {
    return new Response(JSON.stringify({
      manifest: this,
      links: {
        snapshot: info.getLinkUrl(`/${info.org}/sites/${info.site}/snapshots/${this.id}`),
      },
    }, null, 2), {
      headers: {
        'content-type': 'application/json',
      },
    });
  }
}
