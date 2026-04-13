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
 * Resource used by {@link PreviewJob}. Wraps a file returned by a content source handler
 * and tracks its status through the preview pipeline.
 *
 * The `source` object is an opaque payload from the content handler and is serialized
 * as-is; it may contain a numeric `lastModified` timestamp used for not-modified checks.
 */
export class PreviewResource extends Resource {
  /** @type {string} */
  path;

  /**
   * Opaque source object from the content handler. Contains at minimum `lastModified`
   * (numeric Unix ms timestamp) and `type` (e.g. `'markup'`).
   * @type {object|undefined}
   */
  source;

  /** @type {boolean|undefined} true if this is the redirects.json resource */
  redirects;

  /** @type {string|undefined} error code from the content bus */
  errorCode;

  /**
   * @param {string} resourcePath resource path (e.g. `/documents/doc1.md`)
   * @param {string} path web path (e.g. `/documents/doc1`)
   * @param {object} [source] content source metadata object
   */
  constructor(resourcePath, path, source) {
    super(resourcePath);
    this.path = path;
    if (source !== undefined) {
      this.source = source;
    }
  }

  /**
   * @param {object} obj plain object from JSON.parse
   * @returns {PreviewResource}
   */
  static fromJSON(obj) {
    const r = super.fromJSON(obj);
    r.path = obj.path;
    if (obj.source !== undefined) {
      r.source = obj.source;
    }
    if (obj.redirects) {
      r.redirects = true;
    }
    if (obj.errorCode !== undefined) {
      r.errorCode = obj.errorCode;
    }
    return r;
  }

  /**
   * @returns {object}
   */
  toJSON() {
    const obj = super.toJSON();
    obj.path = this.path;
    if (this.source !== undefined) {
      obj.source = this.source;
    }
    if (this.redirects) {
      obj.redirects = true;
    }
    if (this.errorCode !== undefined) {
      obj.errorCode = this.errorCode;
    }
    return obj;
  }

  /**
   * Returns true once this resource has been processed (has a non-zero status).
   * Overrides the base implementation because PreviewJob uses `status === 0` as the
   * "not yet processed" sentinel rather than `undefined`.
   *
   * @returns {boolean}
   */
  isProcessed() {
    return !!this.status;
  }

  /**
   * Sets the error details from a content bus response.
   *
   * @param {string} error error message
   * @param {string} [errorCode] optional error code header value
   */
  setError(error, errorCode) {
    this.error = error;
    if (errorCode !== undefined) {
      this.errorCode = errorCode;
    }
  }
}
