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
import { randomUUID } from 'crypto';
import aws4 from 'aws4';
import wrapFetch from 'fetch-retry';
import { assertRequiredProperties } from '../../support/utils.js';

export class CloudfrontPurgeClient {
  /**
   * Validates the purge config
   * @param {import('@adobe/helix-admin-support').CloudfrontConfig} config
   * @throws {Error} if the config is not valid
   */
  static validate(config) {
    assertRequiredProperties(config, 'invalid purge config', 'distributionId', 'accessKeyId', 'secretAccessKey');
  }

  /**
   * Returns true if the client supports purging by key, otherwise returns false.
   * @param {import('@adobe/helix-admin-support').CloudfrontConfig} config
   * @returns {boolean} always false
   */
  static supportsPurgeByKey(/* config */) {
    return false;
  }

  /**
   * Purges the Cloudfront production CDN
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('@adobe/helix-admin-support').CloudfrontConfig} purgeConfig purge config
   * @param {Object} params purge parameters
   * @param {Array<string>} [params.keys] keys (tags) to purge
   * @param {Array<string>} [params.paths] url paths to purge
   */
  static async purge(context, purgeConfig, { keys, paths }) {
    const { log, suffix } = context;

    const pathsToPurge = [];

    if (keys.length) {
      // purge by key/tag is not supported by cloudfront, fallback to purge all
      pathsToPurge.push('/*');
    } else if (paths.length) {
      pathsToPurge.push(...paths);
    }

    const {
      host, distributionId, accessKeyId, secretAccessKey,
    } = purgeConfig;

    const xmlPaths = pathsToPurge
      .map((path) => {
        if (/\/media_[0-9a-f]{40,}\.[0-9a-z]+$/.test(path) || path.endsWith('.json')) {
          // media or json resource
          return `${path}*`; // purge all query params variants
        } else {
          return path;
        }
      })
      .map((path) => `<Path>${path.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Path>`).join('');
    const body = `<InvalidationBatch xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><Paths><Quantity>${pathsToPurge.length}</Quantity><Items>${xmlPaths}</Items></Paths><CallerReference>${randomUUID()}</CallerReference></InvalidationBatch>`;
    const method = 'POST';
    const opts = aws4.sign(
      {
        service: 'cloudfront',
        path: `/2020-05-31/distribution/${distributionId}/invalidation`,
        method,
        headers: { 'content-type': 'text/xml' },
        body,
      },
      {
        accessKeyId,
        secretAccessKey,
      },
    );

    const MAX_RETRIES = 2;

    const { hostname, path, headers } = opts;
    const id = context.nextRequestId();
    /* c8 ignore next */
    log.info(`${suffix} [${id}] [cloudfront] ${host} purging paths: ${pathsToPurge}`);
    const fetchRetry = wrapFetch(
      context.getFetch(),
      { /* c8 ignore next */ retryDelay: context.attributes.retryDelay ?? 1000 },
    );
    const resp = await fetchRetry(`https://${hostname}${path}`, {
      method,
      headers,
      body,
      retryOn: (attempt, error, response) => {
        // retry on any network error or 5xx status codes
        if (attempt < MAX_RETRIES && (error !== null || response.status >= 500)) {
          /* c8 ignore next */
          log.debug(`${suffix} [cloudfront] ${host} purge failed with ${error || response.status}: retrying (attempt# ${attempt + 1}/${MAX_RETRIES})`);
          return true;
        }
        return false;
      },
    });
    const result = await resp.text();
    if (resp.ok) {
      /* c8 ignore next */
      log.info(`${suffix} [${id}] [cloudfront] ${host} purge succeeded: ${resp.status} - ${result}`);
    } else {
      /* c8 ignore next */
      const msg = `${suffix} [${id}] [cloudfront] ${host} purge failed: ${resp.status} - ${result}`;
      log.error(msg);
      throw new Error(msg);
    }
  }
}
