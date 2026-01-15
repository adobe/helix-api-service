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
import utc from 'dayjs/plugin/utc.js';
import escape from 'lodash.escape';
import xml2js from 'xml2js';
import { fetchS3 } from '@adobe/helix-admin-support';

import SitemapURL from './sitemap-url.js';
import { isInternal } from '../support/utils.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { getSheetData } from '../contentproxy/utils.js';

dayjs.extend(utc);

/**
 * @typedef SitemapEntry
 * @property {string} path path
 * @property {number} lastModified last modifie
 * @property {string} primary-language-url primary language url
 */

/**
 * Turns a string into an array if necessary.
 * @param {array|string} v item
 * @returns an array
 */
function toArray(v) {
  if (Array.isArray(v)) {
    return v;
  }
  return v ? [v] : [];
}

/**
 * Filters a data array by optional offset and limit parameters.
 *
 * @param {URLSearchParams} searchParams search params
 * @param {Array} data data array
 * @returns filtered data array
 */
function jsonFilter(searchParams, data) {
  let result = data;
  if (searchParams.has('offset')) {
    const offset = Number.parseInt(searchParams.get('offset'), 10);
    if (offset > 0) {
      result = result.slice(offset);
    }
  }
  if (searchParams.has('limit')) {
    const limit = Number.parseInt(searchParams.get('limit'), 10);
    if (limit > 0) {
      result = result.slice(0, limit);
    }
  }
  return result;
}

/**
 * Represents a single sitemap language, which may have alternates.
 */
export default class SitemapLanguage {
  constructor({
    origin, source, lastmod,
    hreflang, alternate, extension,
  }) {
    this._origin = origin;
    this._source = source;
    this._lastmod = lastmod;
    this._hreflangs = toArray(hreflang);
    this._alternate = alternate;
    this._extension = extension;

    this._external = this._source.endsWith('.xml');
  }

  /**
   * Initialize this sitemap. Loads either the JSON index contents or the external
   * sitemap.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {number} fetchTimeout fetch timeout
   */
  async init(context, fetchTimeout) {
    const { log } = context;
    if (this._sitemap) {
      return this;
    }

    const data = this._external
      ? await this._fetchRecordsFromExternal(context, fetchTimeout)
      : await this._fetchRecordsFromIndex(context);
    if (data.some((record) => record.path === undefined)) {
      throw new StatusCodeError(`Some entries in ${this._source} do not have a 'path' property`, 400);
    }

    this._urls = new Map();
    this._sitemap = new Map();
    this._unmatched = new Map();
    this._slugs = new Map();

    data.forEach((record) => {
      const { canonical } = record;
      const url = SitemapURL.fromData(this._origin, this._lastmod, record, this._extension);
      if (canonical && canonical !== url.location) {
        log.info(`ignoring: ${url.location}, as it has a different canonical`);
        return;
      }
      this._urls.set(url.location, url);

      const { path, lastModified } = record;
      const loc = this._extension && !path.endsWith('/')
        ? `${this._origin}${path}${this._extension}`
        : `${this._origin}${path}`;
      const value = {
        alternates: [],
      };
      if (this._lastmod && lastModified !== undefined) {
        const date = dayjs.utc(new Date(lastModified * 1000)); // Ensure UTC is used
        if (date.isValid()) {
          value.lastmod = date.format(this._lastmod);
        }
      }
      this._sitemap.set(loc, value);

      const { 'primary-language-url': primaryLanguageUrl } = record;
      const slug = this._getSlug(primaryLanguageUrl || path);
      if (slug) {
        this._slugs.set(slug, { path, loc });
      } else if (primaryLanguageUrl) {
        this._unmatched.set(primaryLanguageUrl, { path, loc });
      }
    });
    return this;
  }

  /**
   * Fetch sitemap entries from a JSON index stored in S3.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @returns {Promise<SitemapEntry[]>} entries
   */
  async _fetchRecordsFromIndex(context) {
    const { contentBusId, log } = context;

    const url = new URL(`s3:${contentBusId}/live${this._source}`);
    const { pathname: key, searchParams } = url;
    const sheet = searchParams.get('sheet');

    const response = await fetchS3(context, 'content', key);
    if (!response.ok) {
      const msg = await response.text();
      throw new StatusCodeError(`Fetching index contents from ${key} failed: ${msg}`, response.status);
    }
    const json = await response.json();
    const extractSitemapData = () => {
      if (sheet) {
        if (json[sheet] === undefined) {
          throw new StatusCodeError(`Fetching index contents from ${key} failed: sheet ${sheet} not found`, 404);
        }
        return json[sheet].data;
      }
      const data = getSheetData(json, ['sitemap', 'default']);
      if (!data) {
        throw new StatusCodeError(`Fetching index contents from ${key} failed: unable to find sheet 'sitemap' or 'default'`, 404);
      }
      return data;
    };

    const data = extractSitemapData();
    const sliced = jsonFilter(searchParams, data);
    const indexed = sliced.filter(({ robots }) => !robots?.toLowerCase().includes('noindex'));

    log.info(`Fetched sitemap index from ${key}. Found ${data.length} entries, sliced: ${sliced.length}, indexed: ${indexed.length}.`);
    return indexed;
  }

  /**
   * Fetch sitemap entries by parsing an external sitemap
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {number} fetchTimeout fetch timeout
   * @returns {Promise<SitemapEntry[]>} entries
   */
  async _fetchRecordsFromExternal(context, fetchTimeout) {
    const { log } = context;
    const fetch = context.getFetch();

    let source;

    try {
      source = new URL(this._source);
    } catch (e) {
      throw new StatusCodeError(`External sitemap [${this._source}] should be a URL: ${e.message}`, 400);
    }

    if (await isInternal(source.hostname, log)) {
      throw new StatusCodeError(`Rejecting to download sitemap from [${this._source}]`, 400);
    }

    const fopts = context.getFetchOptions({ fetchTimeout });
    let resp;

    log.info(`[sitemap] fetching external sitemap from: ${source}`);

    try {
      resp = await fetch(source.href, fopts);
    } catch (e) {
      throw new Error(`Unable to fetch external sitemap from [${source}]: ${e.message}`);

      /* c8 ignore next 5 */
    } finally {
      if (fopts.signal) {
        fopts.signal.clear();
      }
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new StatusCodeError(`Unable to fetch external sitemap from [${source}]: ${text}`, resp.status);
    }

    try {
      const sitemap = await xml2js.parseStringPromise(await resp.text());
      return sitemap.urlset.url.map((url) => {
        const { loc: [loc] } = url;
        const record = {
          path: new URL(loc).pathname,
        };
        if (url.lastmod) {
          record.lastModified = dayjs(url.lastmod[0]).unix();
        }
        return record;
      });
    } catch (e) {
      throw new Error(`Unable to parse external sitemap from '${source} : ${e.message}}`);
    }
  }

  /**
   * Return all sitemap URLs for this language. These are the internal paths prepended
   * by their origin and an optional `lastmod` string.
   */
  urls() {
    return [...this._urls.values()];
  }

  /**
   * Return all sitemap locations for this language. These are the internal paths prepended
   * by their origin.
   */
  locations() {
    return [...this._urls.values()].map(({ location }) => location);
  }

  /**
   * Add alternate languages for ourself.
   */
  addSelfAlternates() {
    for (const loc of this._sitemap.keys()) {
      this.addAlternate(loc, this._hreflangs, loc);
    }
  }

  /**
   * Return all slugs and their full locations in this sitemap.
   *
   * @returns {Map<string, string>} mapping slugs and their locations
   */
  get slugs() {
    return this._slugs;
  }

  /**
   * Return the hreflangs of this language
   */
  get hreflangs() {
    return this._hreflangs;
  }

  /**
   * Return the number of URLs in this language
   */
  get size() {
    return this._urls.size;
  }

  /**
   * Given an absolute path for some language, returns the slug, where the language
   * related part was removed. If the path is not in language relative notation, null is returned.
   *
   * @param {string} path path
   * @returns slug or null
   */
  _getSlug(path) {
    const alternate = this._alternate ?? '/{path}';

    const [prefix, suffix] = alternate.split('{path}');
    const i0 = path.indexOf(prefix);
    const i1 = path.lastIndexOf(suffix);
    if (!(i0 === 0 && i1 === path.length - suffix.length)) {
      return null;
    }
    let slug = path.substring(prefix.length, i1);
    if (this._external) {
      const segs = slug.split('/');
      const [basename] = segs[segs.length - 1].split('.');
      slug = [...segs.slice(0, -1), basename].join('/');
    }
    if (path.startsWith('/') && !slug.startsWith('/')) {
      slug = `/${slug}`;
    }
    return slug;
  }

  /**
   * Given a slug, checks whether this sitemap contains that path as well, and returns
   * the full location, otherwise returns null.
   * @param {string} slug slug
   * @param {string} path internal resource path
   * @returns alternate location or null
   */
  getAlternateLocation(slug, path) {
    let entry = this._slugs.get(slug);
    if (!entry) {
      entry = this._unmatched.get(path);
      if (entry) {
        this._slugs.set(slug, entry);
      }
    }
    return entry?.loc;
  }

  /**
   * Add an alternate for an existing location
   *
   * @param {string} loc URL location in *this* sitemap
   * @param {string} hreflangs languages to add alternate for
   * @param {string} href HREF for that language
   */
  addAlternate(loc, hreflangs, href) {
    hreflangs.forEach((hreflang) => this._sitemap.get(loc).alternates.push({ hreflang, href }));
  }

  /**
   * Returns XML representation of that sitemap
   *
   * @returns XML representation
   */
  toXML() {
    return [...this._sitemap].map(
      ([loc, { lastmod, alternates }]) => {
        let alternatesXml = '';
        if (alternates.length > 0) {
          alternatesXml = alternates.map(
            ({ hreflang, href }) => (`    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${escape(href)}"/>`),
          ).join('\n');
          alternatesXml = `\n${alternatesXml}`;
        }
        let lastmodXml = '';
        if (lastmod) {
          lastmodXml = `\n    <lastmod>${lastmod}</lastmod>`;
        }
        return `  <url>
    <loc>${escape(loc)}</loc>${lastmodXml}${alternatesXml}
  </url>`;
      },
    ).join('\n');
  }

  matchSource(source) {
    return !this.source.endsWith('.xml') && this.source.split('?')[0] === source;
  }

  /**
   * Return the language source. This is the resource path of its JSON representation.
   */
  get source() {
    return this._source;
  }
}
