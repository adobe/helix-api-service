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

import { Resource } from '../job/Resource.js';

/**
 * Resource used by {@link PublishJob}. Tracks the full lifecycle of a content resource
 * through the publish pipeline: publish → purge → index → notify.
 */
export class PublishResource extends Resource {
  /** @type {string} */
  path;

  /** @type {boolean|undefined} true if this is a metadata resource (processed first) */
  metadata;

  /** @type {boolean|undefined} true if this is the redirects.json resource */
  redirects;

  /** @type {boolean|undefined} true once the CDN cache has been purged */
  purged;

  /** @type {boolean|undefined} true once the resource has been indexed */
  indexed;

  /** @type {boolean|undefined} true once the bulk notification has been sent */
  notified;

  /**
   * @param {string} resourcePath resource path (e.g. `/documents/doc1.md`)
   * @param {string} path web path (e.g. `/documents/doc1`)
   */
  constructor(resourcePath, path) {
    super(resourcePath);
    this.path = path;
  }

  /**
   * Deserializes a PublishResource from a plain object stored in job state.
   * Coerces `lastModified` from ISO string to {@link Date} so that
   * date comparisons work correctly after a state reload.
   *
   * @param {object} obj plain object from JSON.parse
   * @returns {PublishResource}
   */
  static fromJSON(obj) {
    const r = super.fromJSON(obj);
    r.path = obj.path;
    if (obj.metadata) {
      r.metadata = true;
    }
    if (obj.redirects) {
      r.redirects = true;
    }
    if (obj.purged) {
      r.purged = true;
    }
    if (obj.indexed) {
      r.indexed = true;
    }
    if (obj.notified) {
      r.notified = true;
    }
    return r;
  }

  /**
   * @returns {object}
   */
  toJSON() {
    const obj = super.toJSON();
    obj.path = this.path;
    if (this.metadata) {
      obj.metadata = true;
    }
    if (this.redirects) {
      obj.redirects = true;
    }
    if (this.purged) {
      obj.purged = true;
    }
    if (this.indexed) {
      obj.indexed = true;
    }
    if (this.notified) {
      obj.notified = true;
    }
    return obj;
  }

  // ── State transitions ──────────────────────────────────────────────────────

  /** Marks this resource as not modified (skipped during publish). */
  setNotModified() {
    this.status = 304;
  }

  /** Marks this resource as purged from the CDN cache. */
  setPurged() {
    this.purged = true;
  }

  /** Marks this resource as indexed. */
  setIndexed() {
    this.indexed = true;
  }

  /** Marks this resource as notified. */
  setNotified() {
    this.notified = true;
  }

  // ── Predicates ─────────────────────────────────────────────────────────────

  /**
   * Returns true if this resource should be purged from the CDN.
   * Resources that were not modified (304) are excluded.
   * @returns {boolean}
   */
  needsPurging() {
    return !this.purged && this.status !== 304;
  }

  /**
   * Returns true if this resource should be sent to the indexer.
   * Only resources that have been purged and not yet indexed are included;
   * not-modified (304) resources are excluded.
   * @returns {boolean}
   */
  needsIndexing() {
    return !!this.purged && !this.indexed && this.status !== 304;
  }

  /**
   * Returns true if a notification should be sent for this resource.
   * Not-modified (304) resources are excluded.
   * @returns {boolean}
   */
  needsNotification() {
    return !this.notified && this.status !== 304;
  }

  /**
   * Returns true if this resource has been fully published (purged and indexed).
   * @returns {boolean}
   */
  isPublished() {
    return !!this.purged && !!this.indexed;
  }
}
