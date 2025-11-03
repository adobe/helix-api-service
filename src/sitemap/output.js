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
import xml2js from 'xml2js';
import { HelixStorage } from '@adobe/helix-shared-storage';
import SitemapURL from './sitemap-url.js';
import { StatusCodeError } from '../support/StatusCodeError.js';

/**
 * Maximum number of URLs per output file.
 */
const MAXIMUM_NUM_URLS = 50000;

/**
 * Represents a sitemap output, that can be fed by one more than one language
 * when aggregating multiple languages.
 */
export default class SitemapOutput {
  constructor(destination) {
    this._destination = destination;

    this._languages = [];
  }

  addLanguage(language) {
    this._languages.push(language);
  }

  containsAny(languages) {
    return languages.some((l) => this._languages.includes(l));
  }

  /**
   * Returns a flag indicating whether this output changed.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {number} fetchTimeout fetch timeout
   * @returns {boolean} true if the output changed, false otherwise
   */
  async changed(context, fetchTimeout) {
    const { contentBusId, log } = context;
    const { _languages: languages } = this;
    const newURLs = [];

    try {
      await Promise.all(languages.map(async (l) => l.init(context, fetchTimeout)));
    } catch (e) {
      log.error('Detecting changes in sitemap failed', e);
      return false;
    }

    languages.forEach((language) => {
      const urls = language.urls();
      if (urls.length > MAXIMUM_NUM_URLS) {
        throw new StatusCodeError(`language sitemap source ${language.source} contains more than ${MAXIMUM_NUM_URLS} entries: ${urls.length}`, 413);
      }
      newURLs.push(...urls);
    });
    if (newURLs.length > MAXIMUM_NUM_URLS) {
      throw new StatusCodeError(`destination sitemap ${this.destination} contains more than ${MAXIMUM_NUM_URLS} entries: ${newURLs.length}`, 413);
    }

    const storage = HelixStorage.fromContext(context).contentBus();
    const path = `/${contentBusId}/live${this._destination}`;
    let buf;

    try {
      log.info(`reading old sitemap from: ${path}`);
      buf = await storage.get(path);
    } catch (e) {
      throw new Error(`Fetching sitemap from ${path} failed`, e.message);
    }

    if (!buf) {
      return true;
    }
    const xml = await xml2js.parseStringPromise(buf.toString());
    const url = xml?.urlset?.url || [];
    const oldURLs = url.map((element) => SitemapURL.fromXML(element));

    if (oldURLs.length !== newURLs.length) {
      log.info(`number of sitemap URLs changed (${oldURLs.length} <> ${newURLs.length})`);
      return true;
    }
    for (let i = 0; i < oldURLs.length; i += 1) {
      if (!oldURLs[i].equals(newURLs[i])) {
        log.info(`sitemap URL changed: '${oldURLs[i]}' <> '${newURLs[i]}'`);
        return true;
      }
    }
    return false;
  }

  toXML() {
    const xml = this._languages.map(
      (language) => language.toXML(),
    ).join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${xml}
</urlset>
`;
  }

  async store(context, updatePreview) {
    const { contentBusId, log } = context;

    let path = `/${contentBusId}/live${this._destination}`;
    const storage = HelixStorage.fromContext(context).contentBus();

    try {
      log.info(`Storing sitemap to: ${path}`);
      await storage.put(path, this.toXML(), 'text/xml', {});
    } catch (e) {
      throw new Error(`Uploading ${path} to storage failed: ${e.message}`);
    }
    if (updatePreview) {
      path = `/${contentBusId}/preview${this._destination}`;

      try {
        log.info(`Storing sitemap to: ${path}`);
        await storage.put(path, this.toXML(), 'text/xml', {});
      } catch (e) {
        throw new Error(`Uploading ${path} to storage failed: ${e.message}`);
      }
    }
  }

  get destination() {
    return this._destination;
  }

  /**
   * Check that the number of URLs this output will contain does not exceed limits.
   */
  checkLimit() {
    const { _languages: languages } = this;
    const urls = languages.reduce((total, language) => {
      const { size } = language;
      if (size > MAXIMUM_NUM_URLS) {
        throw new StatusCodeError(`language sitemap source ${language.source} contains more than ${MAXIMUM_NUM_URLS} entries: ${size}`, 413);
      }
      return total + size;
    }, 0);
    if (urls > MAXIMUM_NUM_URLS) {
      throw new StatusCodeError(`destination sitemap ${this.destination} contains more than ${MAXIMUM_NUM_URLS} entries: ${urls}`, 413);
    }
  }
}
