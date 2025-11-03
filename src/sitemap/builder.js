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
import processQueue from '@adobe/helix-shared-process-queue';
import SitemapLanguage from './language.js';
import SitemapOutput from './output.js';
import { StatusCodeError } from '../support/StatusCodeError.js';

/**
 * Combines all sitemaps and computes the global structure
 * of the sitemap including all alternates.
 */
export default class SitemapBuilder {
  constructor({
    config, origin: defaultOrigin,
  }) {
    this._config = config;
    this._languages = [];
    this._outputs = [];

    if (!config.languages) {
      // single sitemap, so create just one output and language
      const {
        source, origin = defaultOrigin, lastmod, destination, extension,
      } = config;

      const output = this._getOrCreateOutput(destination);
      this._addLanguage({
        source, origin, lastmod, extension,
      }, output);
      return;
    }

    // iterate over all languages and create outputs when required
    Object.values(config.languages).forEach((languageConfig) => {
      const { origin = defaultOrigin, lastmod } = config;
      const {
        source, hreflang, alternate, destination,
      } = languageConfig;

      const output = this._getOrCreateOutput(destination);
      this._addLanguage({
        origin,
        source,
        lastmod,
        hreflang,
        alternate,
        extension: languageConfig.extension ?? config.extension,
      }, output);
    });

    if (config.default) {
      // FIXME: should rather be the name of the language, not its hreflang
      this._default = this._languages.find((l) => l.hreflangs.includes(config.default));
    }
  }

  /**
   * Creates a new SitemapOutput or returns an existing one. Used to aggregate the
   * output of more than one sitemap into a single XML file.
   *
   * @param {string} destination destination
   * @returns new or existing SitemapOutput
   */
  _getOrCreateOutput(destination) {
    let output = this._outputs.find((o) => o.destination === destination);
    if (!output) {
      output = new SitemapOutput(destination);
      this._outputs.push(output);
    }
    return output;
  }

  /**
   * Adds a new language to this builder, with an existing output connected to it.
   *
   * @param {object} opts options
   * @param {SitemapOutput} output existing output
   * @returns new language
   */
  _addLanguage(opts, output) {
    const language = new SitemapLanguage(opts);
    this._languages.push(language);
    output.addLanguage(language);
    return language;
  }

  /**
   * Given a source that changed, checks whether some of the dependent sitemaps
   * did change.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {string} source source that changed
   * @param {number} fetchTimeout fetch timeout
   * @returns true if some sitemap did change, otherwise false
   */
  async changed(context, source, fetchTimeout) {
    // This is a bit complex: for every sitemap language that has the source given
    // we have to check whether the possibly aggregated output did change
    const languages = this._languages.filter((language) => language.matchSource(source));
    const outputs = this._outputs.filter((output) => output.containsAny(languages));

    try {
      const results = await Promise.all(outputs
        .map(async (output) => output.changed(context, fetchTimeout)));
      return results.find((r) => r);
    } catch (e) {
      throw new Error(`Detecting changes in sitemap failed: ${e.message}`);
    }
  }

  /**
   * Iterates over all languages in that sitemap and creates the locations map
   * including alternates.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {number} fetchTimeout fetch timeout
   */
  async build(context, fetchTimeout) {
    try {
      await Promise.all(this._languages
        .map(async (language) => language.init(context, fetchTimeout)));
    } catch (e) {
      throw new StatusCodeError(`Building sitemap failed: ${e.message}`, e.statusCode);
    }

    const multilang = this._languages.length > 1;
    for (let i = 0; i < this._languages.length; i += 1) {
      const current = this._languages[i];
      if (multilang) {
        current.addSelfAlternates();
      }

      for (const [canon, { path, loc }] of [...current.canonicals]) {
        // find all alternates in members following
        for (let j = i + 1; j < this._languages.length; j += 1) {
          const alt = this._languages[j];
          const alternateLoc = alt.getAlternateLocation(canon, path);
          if (alternateLoc) {
            // found an alternate, add to that tree and to ours
            alt.addAlternate(alternateLoc, current.hreflangs, loc);
            current.addAlternate(loc, alt.hreflangs, alternateLoc);
          }
        }
        if (this._default) {
          const defaultLoc = this._default.getAlternateLocation(canon);
          if (defaultLoc) {
            // found a default entry, add to this tree
            current.addAlternate(loc, ['x-default'], defaultLoc);
          }
        }
      }
    }
  }

  /**
   * Stores all sitemaps generated.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {boolean} updatePreview whether to update preview partition as well
   */
  async store(context, updatePreview) {
    /** @type {SitemapOutput[]} */
    const outputs = [...this._outputs];
    outputs.forEach((output) => output.checkLimit());

    try {
      const paths = await processQueue(outputs, async (output) => {
        await output.store(context, updatePreview);
        return output.destination;
      });
      return { paths };
    } catch (e) {
      throw new Error(`Error storing sitemap: ${e.message}`);
    }
  }
}
