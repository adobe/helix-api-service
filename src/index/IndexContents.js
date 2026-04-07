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
import { jsonPath } from './utils.js';
import { getDefaultSheetData } from '../contentproxy/utils.js';

/**
 * Represents the index contents, i.e. the rows stored at the index target.
 * @class
 */
export class IndexContents {
  /** @type {object} */
  config;

  /**
   * Create a new index contents, given its index configuration.
   *
   * @param {object} config index configuration
   * @constructor
   */
  constructor(config) {
    this.config = config;
    this.name = config.name;
  }

  /**
   * Load the index contents.
   *
   * @param {string} contentBusId content bus id
   * @param {object} storage storage bucket
   * @param {object} log logger
   * @return {Promise<object[]|null>} rows or null if the index contents is unavailable
   */
  async load(contentBusId, storage, log) {
    const { config: { target }, name } = this;

    const jsonTarget = jsonPath(target.replace(/^s3:\//, ''));
    const key = `/${contentBusId}/live${jsonTarget}`;
    const contents = await storage.get(key);
    if (!contents) {
      log.warn(`Unable to fetch paths for index ${name}, index contents not found: ${target}`);
      return null;
    }
    const data = getDefaultSheetData(JSON.parse(contents));
    if (!Array.isArray(data)) {
      log.warn(`Unable to fetch paths for index ${name}, index contents not iterable (${data}): ${target}`);
      return null;
    }
    return data.filter((row) => !!row.path);
  }
}
