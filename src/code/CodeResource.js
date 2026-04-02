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
 * Resource used by {@link CodeJob}. Represents a file in the code bus, either added,
 * modified, or deleted as part of a GitHub push event.
 *
 * Unlike content resources, code resources only have a `resourcePath` (no separate web
 * path).
 */
export class CodeResource extends Resource {
  /** @type {string|undefined} */
  contentType;

  /** @type {number|undefined} */
  contentLength;

  /** @type {boolean|undefined} true if this resource was deleted */
  deleted;

  /**
   * @param {object} obj plain object from JSON.parse
   * @returns {CodeResource}
   */
  static fromJSON(obj) {
    const r = super.fromJSON(obj);
    if (obj.contentType !== undefined) {
      r.contentType = obj.contentType;
    }
    if (obj.contentLength !== undefined) {
      r.contentLength = obj.contentLength;
    }
    if (obj.deleted) {
      r.deleted = true;
    }
    return r;
  }

  /**
   * @returns {object}
   */
  toJSON() {
    const obj = super.toJSON();
    if (this.contentType !== undefined) {
      obj.contentType = this.contentType;
    }
    if (this.contentLength !== undefined) {
      obj.contentLength = this.contentLength;
    }
    if (this.deleted) {
      obj.deleted = true;
    }
    return obj;
  }

  /**
   * Returns true if this resource was successfully synced or deleted (status < 300).
   * @returns {boolean}
   */
  isSuccess() {
    return this.status < 300;
  }

  /**
   * Factory that creates a CodeResource from a change event entry.
   * Replaces the standalone `createResourceInfo(change, status, error)` function.
   *
   * @param {object} change change entry from the GitHub push event
   * @param {number} [status=200] HTTP status to assign
   * @param {string} [error] optional error message
   * @returns {CodeResource}
   */
  static fromChange(change, status = 200, error = null) {
    const r = new CodeResource(`/${change.path}`);
    r.status = status;
    if (error) {
      r.error = error;
    }

    if (change.type === 'deleted') {
      r.deleted = true;
    } else {
      r.setLastModified(change.lastModified);
      if (change.contentType) {
        r.contentType = change.contentType;
      }
    }
    if (change.contentLength !== undefined) {
      r.contentLength = change.contentLength;
    }

    return r;
  }
}
