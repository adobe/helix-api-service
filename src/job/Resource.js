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

/**
 * Base class for job resources. Encapsulates the fields and operations common to all
 * resource types used by job state: serialization to/from JSON, status tracking, and
 * error recording.
 *
 * Subclasses extend this with domain-specific fields and methods, and must override
 * {@link fromJSON} and {@link toJSON} to handle any additional fields.
 */
export class Resource {
  /** @type {string} */
  resourcePath;

  /** @type {number|undefined} */
  status;

  /** @type {string|undefined} */
  error;

  /**
   * Last modified date of this resource.
   * Always a {@link Date} instance — coerced from ISO string on deserialization.
   * @type {Date|undefined}
   */
  lastModified;

  /**
   * @param {string} resourcePath resource path (e.g. `/documents/doc1.md`)
   */
  constructor(resourcePath) {
    this.resourcePath = resourcePath;
  }

  /**
   * Deserializes a resource from a plain object, as produced by {@link toJSON} and stored in
   * job state. Subclasses should override this method, call `super.fromJSON(obj)`, and assign
   * their own fields — including any necessary type coercions (e.g. string → Date).
   *
   * Because this is a static method, `this` refers to the class on which it is called, so
   * `super.fromJSON(obj)` in a subclass correctly constructs an instance of the subclass.
   *
   * @param {object} obj plain object from JSON.parse
   * @returns {Resource} deserialized resource instance
   */
  static fromJSON(obj) {
    const r = new this(obj.resourcePath);
    if (obj.status !== undefined) {
      r.status = obj.status;
    }
    if (obj.error !== undefined) {
      r.error = obj.error;
    }
    r.setLastModified(obj.lastModified);
    return r;
  }

  /**
   * Serializes this resource to a plain object suitable for `JSON.stringify`.
   * Called automatically by `JSON.stringify`. Subclasses should override this method,
   * call `super.toJSON()`, and spread in their own fields.
   *
   * Only defined (non-undefined) values are included to keep the serialized state compact.
   *
   * @returns {object} plain serializable object
   */
  toJSON() {
    const obj = { resourcePath: this.resourcePath };
    if (this.status !== undefined) {
      obj.status = this.status;
    }
    if (this.error !== undefined) {
      obj.error = this.error;
    }
    if (this.lastModified !== undefined) {
      obj.lastModified = this.lastModified.toISOString();
    }
    return obj;
  }

  /**
   * Deserializes an array of plain objects (as stored in job state) into resource instances.
   * Delegates to {@link fromJSON} for each element, so subclass overrides are respected.
   *
   * @param {object[]} arr array of plain objects from JSON.parse
   * @returns {Resource[]} array of deserialized resource instances
   */
  static fromJSONArray(arr) {
    return arr ? arr.map((obj) => this.fromJSON(obj)) : [];
  }

  /**
   * Serializes an array of resource instances to plain objects suitable for `JSON.stringify`.
   * Delegates to {@link toJSON} for each element.
   *
   * @param {Resource[]} arr array of resource instances
   * @returns {object[]} array of plain serializable objects
   */
  static toJSONArray(arr) {
    return arr.map((r) => r.toJSON());
  }

  /**
   * Sets the last modified date, coercing any value accepted by the {@link Date} constructor
   * (ISO string, UTC string, timestamp, or existing Date) to a {@link Date} instance.
   *
   * @param {Date|string|number} value last modified value
   */
  setLastModified(value) {
    if (value) {
      this.lastModified = new Date(value);
    }
  }

  /**
   * Sets the HTTP status of this resource, and optionally an error message.
   *
   * @param {number} status HTTP status code
   * @param {string} [error] error message
   */
  setStatus(status, error) {
    this.status = status;
    if (error !== undefined) {
      this.error = error;
    }
  }

  /**
   * Returns true once a status has been assigned to this resource — i.e. it has been
   * processed (or skipped) by the job.
   *
   * @returns {boolean}
   */
  isProcessed() {
    return this.status !== undefined;
  }
}
