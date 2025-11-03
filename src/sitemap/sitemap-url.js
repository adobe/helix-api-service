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
import dayjs from 'dayjs';
import escape from 'lodash.escape';

/**
 * @typedef SitemapURL
 * @property {string} loc the location
 * @property {string} lastmod last modification date, optional
 */
export default class SitemapURL {
  /**
   * Location in URL
   * @property {string} location
   * @private
   */
  #location;

  /**
   * Lastmod in URL, optional
   * @property {string} lastmod
   * @private
   */
  #lastmod;

  constructor(location, lastmod) {
    this.#location = location;
    this.#lastmod = lastmod;
  }

  get location() {
    return this.#location;
  }

  get lastmod() {
    return this.#lastmod;
  }

  equals(other) {
    if (other.location !== this.#location) {
      return false;
    }
    if (other.lastmod !== this.#lastmod) {
      return false;
    }
    return true;
  }

  toString() {
    return (this.#lastmod) ? `${this.#location} (${this.#lastmod})` : this.#location;
  }

  /**
   * Create a sitemap URL from an XML element.
   *
   * @param {object} element XML element
   * @returns {SitemapURL} sitemap URL
   */
  static fromXML(element) {
    const { loc, lastmod } = element;
    return lastmod?.length > 0 ? new SitemapURL(loc[0], lastmod[0]) : new SitemapURL(loc[0]);
  }

  /**
   * Create a sitemap URL from a XML element.
   *
   * @param {string} origin origin
   * @param {string} lastmod lastmod format, optional
   * @param {object} record record containing `path` and `lastModified`
   * @param {string} extension extension to append
   * @returns {SitemapURL} sitemap URL
   */
  static fromData(origin, lastmod, record, extension) {
    const { path, lastModified } = record;
    const unescaped = extension && !path.endsWith('/')
      ? `${origin}${path}${extension}`
      : `${origin}${path}`;
    const location = escape(unescaped);

    if (lastmod && lastModified !== undefined) {
      const date = dayjs(new Date(lastModified * 1000));
      if (date.isValid()) {
        return new SitemapURL(location, date.format(lastmod));
      }
    }
    return new SitemapURL(location);
  }
}
