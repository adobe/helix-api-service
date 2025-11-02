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
import dns from 'node:dns';
import { promisify } from 'util';

const resolve = {
  /**
   * Resolves the CNAME for a given hostname.
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {string} hostname
   *
   * @returns {Promise<string[]>} addresses
   */
  CName: async (context, hostname) => {
    const { log } = context;

    const resolver = new dns.Resolver();
    const dnsResolve = promisify(resolver.resolveCname).bind(resolver);
    let addresses = [];
    try {
      addresses = await dnsResolve(hostname);
      /* c8 ignore next 3 */
    } catch (err) {
      log.error(`failed to resolve CNAME for ${hostname}: ${err}`);
    }
    return addresses;
  },

  /**
   * Returns true if the hostname resolves to a cloudflare zone, otherwise false.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {string} hostname
   *
   * @returns {Promise<boolean>} true if the hostname resolves to a cloudflare zone
   */
  isCloudflareZone: async (context, hostname) => {
    const hostnames = await resolve.CName(context, hostname);
    return hostnames.some((address) => address.endsWith('.cloudflare.net'));
  },
};

export default resolve;
