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

export class ManagedPurgeClient {
  /**
   * Validates the purge config
   * @param {import('@adobe/helix-admin-support').ManagedConfig} config
   * @throws {Error} if the config is not valid
   */
  static validate(config) {
    assertRequiredProperties(config, 'invalid purge config', 'host');
  }

  /**
   * Returns true if the client supports purging by key, otherwise returns false.
   * @param {import('@adobe/helix-admin-support').ManagedConfig} config
   * @returns {boolean} always true
   */
  static supportsPurgeByKey(/* config */) {
    return true;
  }

  /**
   * Purges the Adobe-managed (Fastly) production CDN
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('@adobe/helix-admin-support').ManagedConfig} purgeConfig
   * @param {Object} params purge parameters
   * @param {Array<string>} [params.keys] keys (tags) to purge
   * @param {Array<string>} [params.paths] url paths to purge
   */
  static async purge(context, purgeConfig, { keys = [], paths = [] }) {
    /* c8 ignore next 3 */
    if ((!keys || !keys.length) && (!paths || !paths.length)) {
      return;
    }

    const { log, suffix, env: { HLX_ADMIN_MANAGED_PURGEPROXY_TOKEN: authToken } } = context;
    const fetch = context.getFetch();

    const { host, envId } = purgeConfig;

    let msg;
    let hadErrors = false;
    if (paths?.length) {
      // purge in parallel batches
      const PARALLEL_BATCH_SIZE = 30;
      const purgeUrls = [...paths].map((path) => `https://purgeproxy.adobeaemcloud.com/purgeurl/${host}${path}`);
      await processQueue(purgeUrls, async (url) => {
        const id = context.nextRequestId();
        try {
          /* c8 ignore next */
          log.info(`${suffix} [${id}] [managed] ${host} purging url '${url}'`);
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'x-aem-purge-key': authToken,
            },
          });
          const body = await resp.text();
          if (!resp.ok) {
            hadErrors = true;
            /* c8 ignore next */
            log.error(`${suffix} [${id}] [managed] ${host} url purge failed: ${resp.url} - status: ${resp.status}, body: ${body}`);
          }
          /* c8 ignore next 5 */
        } catch (err) {
          msg = `${suffix} [${id}] [managed] ${host} url purge failed: ${err}`;
          log.error(msg);
          hadErrors = true;
        }
      }, PARALLEL_BATCH_SIZE);
    }
    if (!hadErrors) {
      if (paths?.length) {
        /* c8 ignore next */
        log.info(`${suffix} [managed] ${host} purging ${paths.length} url(s) succeeded`);
      }
    } else {
      throw new Error(`[managed] ${host} purging ${paths.length} url(s) failed`);
    }

    if (keys?.length) {
      const method = 'POST';
      const headers = {
        accept: 'application/json',
        'x-aem-purge-key': authToken,
      };

      const purgeKeys = [...keys];
      while (purgeKeys.length) {
        // only 256 keys can be purged with a single request
        // https://developer.fastly.com/reference/api/purging/#bulk-purge-tag
        const batch = purgeKeys.splice(0, 256);

        const url = `https://purgeproxy.adobeaemcloud.com/purge/${envId || host}`;
        let resp;
        const id = context.nextRequestId();
        try {
          /* c8 ignore next */
          log.info(`${suffix} [${id}] [managed] ${envId || host} purging keys '${batch}'`);
          headers['Surrogate-Key'] = batch.join(' ');
          // eslint-disable-next-line no-await-in-loop
          resp = await fetch(url, { method, headers });
          /* c8 ignore next 5 */
        } catch (err) {
          msg = `${suffix} [${id}] [managed] ${envId || host} purging ${batch.length} surrogate key(s) failed: ${err}`;
          log.error(msg);
          throw new Error(msg);
        }
        // eslint-disable-next-line no-await-in-loop
        const result = await resp.text();
        if (resp.ok) {
          /* c8 ignore next */
          log.info(`${suffix} [managed] ${host} purging ${keys.length} surrogate key(s) succeeded: ${resp.status} - ${result}`);
        } else {
          /* c8 ignore next */
          msg = `${suffix} [managed] ${host} purging ${keys.length} surrogate key(s) failed: ${resp.status} - ${result}`;
          log.error(msg);
          throw new Error(msg);
        }
      }
    }
  }
}
