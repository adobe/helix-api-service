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
import { HelixStorage } from '@adobe/helix-shared-storage';

/**
 * directory for job state files
 */
const JOB_DIRECTORY = '.helix/admin-jobs';

/**
 * Job storage that hides the implementation details where the state of
 * a job is stored and what how files will be prefixed.
 */
export class JobStorage {
  /**
   * @param {Bucket} storage
   * @param {string} prefix
   * @param {string} project
   */
  constructor(storage, prefix, project) {
    this.project = project;
    this.bucket = storage;
    this.prefix = `${prefix}/${JOB_DIRECTORY}`;

    /**
     * Apply the prefix to all bucket operations we support
     */
    ['get', 'put'].forEach((m) => {
      this[m] = async (key, ...args) => storage[m](`${this.prefix}/${key}`, ...args);
    });
  }

  /**
   * Remove object(s) from the job storage
   * @param {string|string[]} key
   * @returns {Promise<void>}
   */
  async remove(key) {
    if (Array.isArray(key)) {
      return this.bucket.remove(key.map((k) => `${this.prefix}/${k}`));
    }
    return this.bucket.remove(`${this.prefix}/${key}`);
  }

  /**
   * List objects in the job storage with a given prefix
   * @param {string} prefix
   * @returns {Promise<Array<{key: string, lastModified: Date, size: number}>>}
   */
  async list(prefix) {
    const result = await this.bucket.list(`${this.prefix}/${prefix}`, { shallow: true });
    // Remove the full prefix from keys to return relative paths
    return result
      .filter((item) => (
        item.key.endsWith('.json') && !item.key.endsWith('-stop.json')
      ))
      .map((item) => ({
        ...item,
        key: item.key.substring(`${this.prefix}/`.length),
      }));
  }

  /**
   * Move an object from one key to another (copy + delete)
   * @param {string} fromKey
   * @param {string} toKey
   * @returns {Promise<void>}
   */
  async move(fromKey, toKey) {
    const source = await this.get(fromKey);
    if (source) {
      // Copy to destination
      await this.put(toKey, source, 'application/json');

      // Delete the source
      await this.remove(fromKey);
    }
  }

  /**
   * Create a new job storage.
   * @param {import('@adobe/helix-universal').AdminContext} ctx context
   * @param {RequestInfo} info
   * @param {object} JobClass job class derivative
   * @returns {Promise<JobStorage>} job storage
   */
  static async create(ctx, info, JobClass) {
    if (JobClass.USE_CODE_BUS) {
      const storage = HelixStorage.fromContext(ctx).codeBus(true);
      const { owner, repo } = info;
      return new JobStorage(storage, `${owner}/${repo}`, `${owner}/${repo}`);
    } else {
      const storage = HelixStorage.fromContext(ctx).contentBus(true);
      return new JobStorage(storage, `${ctx.contentBusId}/preview`, ctx.contentBusId);
    }
  }
}
