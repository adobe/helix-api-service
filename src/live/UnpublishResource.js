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
 * Resource used by {@link UnpublishJob}. Represents a live resource that is to be unpublished,
 * with its last modified date from the live partition.
 */
export class UnpublishResource extends Resource {
  /** @type {string} */
  webPath;

  /**
   * @param {string} resourcePath resource path (e.g. `/documents/doc1.md`)
   * @param {string} webPath web path (e.g. `/documents/doc1`)
   * @param {Date|string} [lastModified] last modified date from storage
   */
  constructor(resourcePath, webPath, lastModified) {
    super(resourcePath);
    this.webPath = webPath;
    this.setLastModified(lastModified);
  }

  /**
   * @param {object} obj plain object from JSON.parse
   * @returns {UnpublishResource}
   */
  static fromJSON(obj) {
    const r = super.fromJSON(obj);
    r.webPath = obj.webPath;
    return r;
  }

  /**
   * @returns {object}
   */
  toJSON() {
    const obj = super.toJSON();
    obj.webPath = this.webPath;
    return obj;
  }

  /**
   * Returns true if this resource was successfully unpublished (HTTP 204).
   * @returns {boolean}
   */
  isDeleted() {
    return this.status === 204;
  }
}
