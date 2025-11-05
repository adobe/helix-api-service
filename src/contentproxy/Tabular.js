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
export default class Tabular {
  constructor(provider) {
    this.provider = provider;
  }

  /**
   * Trims the string at both ends and removes the zero width unicode chars:
   *
   * - U+200B zero width space
   * - U+200C zero width non-joiner Unicode code point
   * - U+200D zero width joiner Unicode code point
   * - U+FEFF zero width no-break space Unicode code point
   *
   * @param {string} str input string
   * @return {string} trimmed and stripped string
   */
  static superTrim(str) {
    if (str === null || str === undefined) {
      // eslint-disable-next-line no-param-reassign
      str = '';
    }
    return String(str)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  /**
   * Selects the shared sheet names (prefixed with 'helix-' or 'shared-')
   * @returns {string[]} the names of the sheets that need to be returned.
   */
  static selectSharedSheetNames(allSheetNames) {
    if (!allSheetNames) {
      return [];
    }

    const sharedSheets = allSheetNames.filter((n) => n.match(/^(helix-|shared-)/));

    let sheetNames = [];
    if (sharedSheets.length === 0) {
      // if no shared sheets, use the first one so long as it's not an 'incoming' sheet
      const firstSheet = allSheetNames[0];
      sheetNames = firstSheet && firstSheet.toLowerCase() !== 'incoming' ? [firstSheet] : [];
    } else {
      // else only use the shared sheets
      sheetNames = sharedSheets;
    }
    return sheetNames;
  }

  withLog(log) {
    this.log = log;
    return this;
  }

  withResource(resource) {
    this.resource = resource;
    return this;
  }

  /**
   * Returns the last modified time
   * @returns {Promise<string>}
   */
  // eslint-disable-next-line class-methods-use-this
  async getLastModified() {
    return '';
  }

  /**
   * Returns the sheet names.
   * @returns {Promise<string[]>}
   */
  // eslint-disable-next-line class-methods-use-this
  async getSheetNames() {
    return [];
  }

  /**
   * Returns the raw data for the given sheet (array of rows, 1st row contains column names)
   * @param {string} sheetName Sheet name
   * @returns {Promise<Array<Object>>}
   */
  // eslint-disable-next-line no-unused-vars,class-methods-use-this
  async getRows(sheetName) {
    return [];
  }

  /**
   * Returns columns and data
   * @param {string} sheetName Sheet name
   * @returns {Promise<Object>}
   */
  async getColumnsAndData(sheetName) {
    const rows = await this.getRows(sheetName);
    if (!rows?.length) {
      return { columns: [], data: [] };
    }
    const columns = rows.shift().map((name) => Tabular.superTrim(name));
    const data = [];
    for (const row of rows) {
      const obj = {};
      let empty = true;
      columns.forEach((name, idx) => {
        if (name) {
          const value = Tabular.superTrim(row[idx]);
          obj[name] = value;
          if (value) {
            empty = false;
          }
        }
      });
      if (!empty) {
        data.push(obj);
      }
    }
    return { columns: columns.filter((name) => name), data };
  }

  /**
   * Returns the data for the given sheet
   * @param {string} sheetName Sheet name
   * @returns {Promise<Array<Object>>}
   */
  async getData(sheetName) {
    const result = await this.getColumnsAndData(sheetName);
    return result.data;
  }

  getProviderName() {
    return this.provider;
  }

  getResource() {
    return this.resource;
  }
}
