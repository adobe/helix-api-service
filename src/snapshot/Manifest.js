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
   * whether the manifest was deleted (prevents store from re-creating it)
   * @type {boolean}
   */
  #deleted = false;

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

  /**
   * Whether the manifest has been loaded from storage.
   * @type {boolean}
   */
  get exists() {
    return this.#exists;
  }

  /**
   * Whether there are resources whose cache needs to be purged.
   * @type {boolean}
   */
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
   * Stores the manifest if modified. No-ops if the manifest was deleted or is unmodified.
   * @returns {Promise<boolean>} resolves to `true` if manifest was stored and needs cache purge
   */
  async store() {
    if (this.#deleted || !this.#isModified) {
      return false;
    }
    if (!this.#exists) {
      const mod = new Date().toISOString();
      this.created = mod;
      this.lastModified = mod;
    }
    await this.#storage.put(this.#key, JSON.stringify(this), 'application/json');
    const wasModified = this.#isModified;
    this.#isModified = false;
    this.#exists = true;
    return wasModified;
  }

  /**
   * Deletes the manifest from storage.
   * @returns {Promise<void>}
   */
  async delete() {
    await this.#storage.remove(this.#key);
    this.#exists = false;
    this.#deleted = true;
  }

  /**
   * Marks the manifest as modified, updating `lastModified`. Called internally by every
   * mutation (lock, setProperty, addResource, removeResource, setReviewState).
   * @param {Date} [now] timestamp to use
   */
  #markModified(now = new Date()) {
    this.lastModified = now.toISOString();
    if (!this.created) {
      this.created = this.lastModified;
    }
    this.#isModified = true;
  }

  /**
   * Marks the manifest as having a resource change, updating `lastUpdated`.
   * Called when a resource is added to or removed from the snapshot storage.
   * @param {Date} [now] timestamp to use
   */
  markResourceUpdated(now = new Date()) {
    this.lastUpdated = now.toISOString();
    this.#markModified(now);
  }

  /**
   * Clears the set of resources that need cache purging.
   */
  markResourcesPurged() {
    this.#resourcesToPurge.clear();
  }

  /**
   * Sets the review workflow state.
   * @param {'requested'|'rejected'|undefined} state
   */
  setReviewState(state) {
    this.review = state;
    this.#markModified();
  }

  /**
   * Locks or unlocks the snapshot. A locked snapshot prevents resource additions and
   * removals. When locking, sets `locked` to the current ISO timestamp. When unlocking,
   * removes the `locked` field. No-ops if the snapshot is already in the requested state.
   * @param {boolean} value `true` to lock, `false` to unlock
   * @returns {boolean} `true` if the lock state was changed, `false` if already in that state
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
    this.#markModified(now);
    return true;
  }

  /**
   * Sets a user-facing custom property on the manifest. Supported properties are
   * `title` (max 4 KB), `description` (max 16 KB), and `metadata` (max 512 KB).
   * A falsy value removes the property.
   * @param {string} name property name (must be in {@link Manifest.CUSTOM_PROPERTIES})
   * @param {string|object} value property value, or falsy to remove
   * @throws {Error} if the property name is not supported or the value exceeds the size limit
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
        this.#markModified();
      }
    } else if (this[name] !== undefined) {
      delete this[name];
      this.#markModified();
    }
  }

  /**
   * Adds or updates a resource in the manifest. If the resource already exists with a
   * different status, the status is updated and the resource is marked for cache purging.
   * @param {string} path web path of the resource
   * @param {number} [status=200] resource status (200 = exists, 404 = marked for deletion)
   */
  addResource(path, status = 200) {
    if (!this.resources.has(path)) {
      this.resources.set(path, { path, status });
      this.#markModified();
    } else {
      const existing = this.resources.get(path);
      if (existing.status !== status) {
        existing.status = status;
        this.#markModified();
      }
      // only need to purge if already existed
      this.#resourcesToPurge.add(path);
    }
  }

  /**
   * Removes a resource from the manifest and marks it for cache purging.
   * @param {string} path web path of the resource
   * @param {boolean} [forcePurge] if true, marks the path for purging even if not in manifest
   */
  removeResource(path, forcePurge) {
    if (this.resources.has(path)) {
      this.resources.delete(path);
      this.#markModified();
      this.#resourcesToPurge.add(path);
    } else if (forcePurge) {
      this.#resourcesToPurge.add(path);
    }
  }

  /**
   * Serializes the manifest to a plain object for JSON.stringify. Resources are sorted
   * alphabetically by path.
   * @returns {object}
   */
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

  /**
   * Returns a JSON response containing the manifest and snapshot links.
   * @param {RequestInfo} info request info
   * @returns {Response}
   */
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
