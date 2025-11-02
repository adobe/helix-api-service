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
import { assertRequiredProperties } from '../../support/utils.js';

export class CloudflarePurgeClient {
  /**
   * Validates the purge config
   * @param {import('@adobe/helix-admin-support').CloudflareConfig} config
   * @throws {Error} if the config is not valid
   */
  static validate(config) {
    assertRequiredProperties(config, 'invalid purge config', 'host', 'zoneId', 'apiToken');
  }

  /**
   * Returns true if the client supports purging by key, otherwise returns false.
   * @param {import('@adobe/helix-admin-support').CloudflareConfig} config
   * @returns {boolean} always true
   */
  static supportsPurgeByKey(/* config */) {
    return true;
  }

  /**
   * Purges the Cloudflare production CDN
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('@adobe/helix-admin-support').CloudflareConfig} purgeConfig the purge config
   * @param {Object} params purge parameters
   * @param {Array<string>} [params.keys] keys (tags) to purge
   * @param {Array<string>} [params.paths] url paths to purge
   */
  static async purge(context, purgeConfig, { keys, paths }) {
    const { log, suffix } = context;
    const { host, zoneId, apiToken } = purgeConfig;
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
    const headers = { Authorization: `Bearer ${apiToken}` };
    const method = 'POST';
    const fetch = context.getFetch();

    // cloudflare API has a limit of 30 urls/tags per purge
    const BATCH_SIZE = 30;

    const payloads = [];
    const tags = keys?.length ? [...keys] : [];
    if (paths?.length) {
      // due to serious limitations of cloudflare's purge-by-url implementation
      // we've added the url path as a cache tag and we're purging by cache-tag only
      tags.push(...paths);
    }
    while (tags.length) {
      payloads.push({
        tags: tags.splice(0, BATCH_SIZE),
      });
    }

    await processQueue(payloads, async (body) => {
      const id = context.nextRequestId();
      /* c8 ignore next */
      log.info(`${suffix} [${id}] [cloudflare] purging '${host}' with ${JSON.stringify(body)}`);
      const resp = await fetch(url, { method, headers, body });
      const result = await resp.text();
      if (resp.ok && JSON.parse(result).success === true) {
        /* c8 ignore next */
        log.info(`${suffix} [${id}] [cloudflare] ${host} purge succeeded: ${result}`);
      } else {
        /* c8 ignore next */
        const msg = `${suffix} [${id}] [cloudflare] ${host} purge failed: ${resp.status} - ${result} - cf-ray: ${resp.headers.get('cf-ray')}`;
        log.error(msg);
        /* c8 ignore next */
        log.error(`${suffix} [${id}] [cloudflare] ${host} purge body was: ${JSON.stringify(body)}`);
        throw new Error(msg);
      }
    });
  }
}
