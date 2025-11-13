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
/* eslint-disable class-methods-use-this */
import { getOneDriveClient } from '../../support/onedrive.js';

/**
 * see https://learn.microsoft.com/en-us/defender-cloud-apps/troubleshooting-proxy-url
 */
const DEFENDER_DNS_SUFFIXES = [
  '.admin-rs-mcas.ms',
  '.rs-mcas.ms',
  '.admin-rs-mcas-df.ms',
  '.rs-mcas-df.ms',
  '.admin-mcas.ms',
  '.mcas.ms',
  '.admin-mcas-df.ms',
  '.mcas-df.ms',
  '.admin-mcas-gov.us',
  '.mcas-gov.us',
  '.admin-mcas-gov-df.us',
  '.mcas-gov-df.us',
  '.admin-mcas-gov.ms',
  '.mcas-gov.ms',
  '.admin-mcas-gov-df.ms',
  '.mcas-gov-df.ms',
];

/**
 * sharepoint hostnames that need no candidate
 */
const KNOWN_HOSTNAMES = ['adobe.sharepoint.com', 'adobe-my.sharepoint.com'];

/**
 * regex for allitems directory listing, with optional digit suffix
 */
const ALLITEMS_REGEX = /\/Forms\/AllItems\d*\.aspx$/;

/**
 * regex for streams
 */
const STREAM_REGEX = /\/_layouts\/15\/stream\.aspx$/;

/**
 * Strips access specifiers from the beginning of a sharepoint URL
 *
 * @param {string} pathname path name
 * @returns stripped pathname
 */
function stripAccessSpecifiers(pathname) {
  const segs = pathname.split('/');
  if (segs.length >= 3 && segs[1].match(/:\w:$/)) {
    return [segs[0], ...segs.slice(3)].join('/');
  }
  return pathname;
}

/**
 * Matcher that filters inventory entries against known sharepoint sites.
 */
export default class SharepointMatcher {
  constructor(context) {
    this.context = context;
  }

  /**
   * Returns a matcher for document URLs given as `/_layouts/15/Doc.aspx`
   *
   * @param {String[]} segs segments to use for site lookup
   * @param {URL} url original URL
   * @param {import('../inventory.js').InventoryEntry} candidate candidate entry
   *        that can be used to determine content bus ID and owner
   * @returns matcher
   */
  async documentMatcher(segs, url, candidate) {
    const { attributes, env, log } = this.context;

    try {
      const client = await getOneDriveClient({
        bucketMap: attributes.bucketMap,
        org: candidate?.org,
        contentBusId: candidate?.contentBusId,
        logFields: {
          operation: 'discover',
        },
        env,
        log,
      });
      await client.auth.initTenantFromUrl(url);

      const itemId = url.searchParams.get('sourcedoc').replace(/[{}]/g, '');
      const api = `/sites/${url.hostname}:${segs.join('/')}:/items/${itemId}`;
      const { webUrl } = await client.doFetch(api);
      const lowerWeb = webUrl.toLowerCase();

      return (sharepointSite) => lowerWeb.startsWith(sharepointSite.toLowerCase());
    } catch (e) {
      log.info(`Unable to resolve document by ID: ${url}: ${e.message}`);
    }

    const resolvedURL = new URL(segs.join('/'), url);
    const href = resolvedURL.href.toLowerCase();
    return (sharepointSite) => sharepointSite.toLowerCase().startsWith(href);
  }

  /**
   * Returns a matcher for the given URL.
   *
   * @param {URL} url url to resolve
   * @param {import('../inventory.js').Inventory} inventory inventory
   * @returns resolved URL
   */
  async getMatcher(url, inventory) {
    const { log } = this.context;
    let { pathname } = url;
    pathname = stripAccessSpecifiers(pathname);

    if (pathname.match(/\/_layouts\/15\/[\w]+\.aspx$/) && url.searchParams.has('sourcedoc')) {
      const segs = pathname.split('/');
      const idx = segs.indexOf('_layouts');
      segs.length = idx;

      let candidate;
      if (!KNOWN_HOSTNAMES.includes(url.hostname)) {
        // first try to find a candidate that matches everything up to `/_layouts`
        const site = `${url.origin}${segs.map((s) => s.toLowerCase()).join('/')}`;
        candidate = inventory.entries().find(
          (e) => e.sharepointSite?.toLowerCase().startsWith(site),
        );
        // otherwise, use the first match for the hostname
        if (!candidate) {
          candidate = inventory.entries().find(
            (e) => e.sharepointSite?.toLowerCase().startsWith(url.origin),
          );
        }
        if (!candidate) {
          log.info(`[discover] unable to find any repository with sharepoint: ${url.origin}`);
          return () => false;
        }
      }
      return this.documentMatcher(segs, url, candidate);
    }

    if (ALLITEMS_REGEX.test(pathname)) {
      if (url.searchParams.has('id')) {
        pathname = url.searchParams.get('id');
      } else if (url.searchParams.has('RootFolder')) {
        pathname = url.searchParams.get('RootFolder');
      } else {
        log.info(`[discover] /Forms/AllItems.aspx does neither contain 'id' nor 'RootFolder': ${url.searchParams}`);
        return () => false;
      }
    } else if (STREAM_REGEX.test(pathname)) {
      if (url.searchParams.has('id')) {
        pathname = url.searchParams.get('id');
      } else {
        log.info(`[discover] /stream.aspx does not contain 'id': ${url.searchParams}`);
        return () => false;
      }
    }
    let resolvedURL;
    try {
      resolvedURL = new URL(pathname.toLowerCase(), url);
    } catch (e) {
      log.info(`[discover] unable to combine pathname ${pathname}: ${e.message}`);
      return () => false;
    }
    return (sharepointSite) => {
      let end = sharepointSite.length;
      if (sharepointSite.endsWith('/')) {
        end -= 1;
      }
      const lowercaseSite = sharepointSite.substring(0, end).toLowerCase();
      return lowercaseSite === resolvedURL.href || resolvedURL.href.startsWith(`${lowercaseSite}/`);
    };
  }

  /**
   * Find the inventory entries that have the given sharepoint document, spreadsheet
   * or folder in their tree.
   *
   * @param {URL} url google document or spreadsheet
   * @param {Inventory} inventory inventory of entries
   */
  async filter(url, inventory) {
    const suffix = DEFENDER_DNS_SUFFIXES.find((s) => url.hostname.endsWith(s));
    if (suffix) {
      // eslint-disable-next-line no-param-reassign
      url.hostname = url.hostname.substring(0, url.hostname.length - suffix.length);
    }
    const matcher = await this.getMatcher(url, inventory);
    return inventory.entries()
      .filter(({ sharepointSite }) => sharepointSite && matcher(sharepointSite))
      .sort(({ sharepointSite: site1, sharepointSite: site2 }) => site1.length - site2.length);
  }

  /**
   * Test whether this class can handle an URL
   *
   * @param {URL} url url to match
   * @param {Inventory} inventory
   * @returns true if this class can handle the URL
   */
  static match(url, inventory) {
    return inventory.getHostType(url.hostname) === 'sharepoint'
      || DEFENDER_DNS_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
  }

  /**
   * Extract some data from a URL to store in the inventory.
   *
   * @param {URL} url url to extract data from
   * @param entry entry to extract into
   * @returns object that contains additional entries to store in inventory
   */
  static async extract(context, url, entry) {
    let pathname = stripAccessSpecifiers(url.pathname);
    if (ALLITEMS_REGEX.test(pathname)) {
      pathname = url.searchParams.get('id');
    }
    // eslint-disable-next-line no-param-reassign
    entry.sharepointSite = new URL(pathname, url).href;
  }
}
