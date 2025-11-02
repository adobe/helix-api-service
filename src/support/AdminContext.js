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
import { keepAliveNoCache, timeoutSignal } from '@adobe/fetch';
import { parseBucketNames } from '@adobe/helix-shared-storage';
import { getCachePlugin } from '@adobe/helix-shared-tokencache';
import { GoogleClient } from '@adobe/helix-google-support';
import { OneDrive, OneDriveAuth } from '@adobe/helix-onedrive-support';
import { authorize } from '../auth/authzn.js';
import { getAuthInfo } from '../auth/support.js';
import { loadOrgConfig, loadSiteConfig } from '../config/utils.js';
import fetchRedirects from '../redirects/fetch.js';
import { StatusCodeError } from './StatusCodeError.js';
import sourceLock from './source-lock.js';
import { coerceArray } from './utils.js';

const APP_USER_AGENT = 'NONISV|Adobe|AEMContentSync/1.0';

export class AdminContext {
  /**
   * @constructs AdminContext
   * @param {import('@adobe/helix-universal').UniversalContext} context universal context
   * @param {object} [opts]
   * @param {import('@adobe/fetch').Headers} [opts.headers] headers
   * @param {object} [opts.attributes] attributes
   */
  constructor(context, { headers = null, attributes = {} } = {}) {
    this.suffix = context.pathInfo.suffix;
    this.data = context.data;
    this.log = context.log || console;
    this.env = { ...context.env };

    this.attributes = {
      errors: [],
      details: [],
      bucketMap: parseBucketNames(this.env.HELIX_BUCKET_NAMES),
      ...attributes,
    };

    this.requestId = headers?.get('x-request-id')
      || headers?.get('x-cdn-request-id')
      || '';
    this.githubToken = headers?.get('x-github-token') || '';

    // If we have a github token, we want to check if we have a base url override as well
    if (this.githubToken) {
      const GH_BASE_URL = headers.get('x-github-base');
      const GH_RAW_URL = headers.get('x-github-raw');
      if (GH_BASE_URL && GH_BASE_URL !== 'https://api.github.com') {
        this.env.GH_BASE_URL = GH_BASE_URL;
        this.env.GH_RAW_URL = GH_RAW_URL;
        // this is used to differentiate to a configured byogit
        this.env.GH_EXTERNAL = true;
      }
    }
  }

  static create(context, opts) {
    return Object.freeze(new AdminContext(context, opts));
  }

  /**
   * Loads the site configuration.
   *
   * @param {import('./RequestInfo.js').RequestInfo} info info
   * @returns {Promise<object>} configuration
   */
  async getConfig(info) {
    if (this.attributes.config === undefined) {
      const { org, site } = info;
      if (org && site) {
        const config = await loadSiteConfig(this, org, site);
        if (config === null) {
          throw new StatusCodeError('', 404);
        }
        const { code: { owner, repo } } = config;
        info.withCode(owner, repo);
        this.attributes.config = config;
      }
    }
    return this.attributes.config;
  }

  async getOrgConfig(info) {
    if (this.attributes.orgConfig === undefined) {
      const { org } = info;
      if (org) {
        const config = await loadOrgConfig(this, org);
        if (config === null) {
          throw new StatusCodeError('', 404);
        }
        this.attributes.orgConfig = config;
      }
    }
    return this.attributes.orgConfig;
  }

  async getRedirects(partition) {
    const { attributes } = this;

    if (!attributes.redirects) {
      attributes.redirects = {};
    }
    if (!attributes.redirects[partition]) {
      attributes.redirects[partition] = await fetchRedirects(this, partition);
    }
    return attributes.redirects[partition];
  }

  /**
   * Authenticates current user. It checks if the request contains authentication information and
   * sets user data.
   *
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @returns {Promise<AuthInfo>} the authentication info
   */
  // eslint-disable-next-line no-unused-vars
  async authenticate(info) {
    const { attributes } = this;

    await this.getConfig(info);

    if (attributes.authInfo === undefined) {
      attributes.authInfo = await getAuthInfo(this, info);
    }
    return attributes.authInfo;
  }

  /**
   * Authorizes the current user by loading the project config and assigning the roles.
   *
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @returns {Promise<void>}
   */
  async authorize(info) {
    // eslint-disable-next-line no-unused-vars
    const orgConfig = await this.getOrgConfig(info);

    return authorize(this, info);
  }

  /**
   * Returns the normalized site access configuration for the current partition.
   *
   * @param {string} partition partition
   * @returns {Promise<object>} the access configuration for this partition
   */
  async getSiteAccessConfig(partition) {
    const { attributes } = this;
    const { config } = attributes;

    if (!attributes.accessConfig?.[partition]) {
      if (!attributes.accessConfig) {
        attributes.accessConfig = {};
      }
      const access = config?.data?.access;
      if (!access) {
        attributes.accessConfig[partition] = {
          allow: [],
          apiKeyId: [],
          secretId: [],
        };
      } else {
        attributes.accessConfig[partition] = {
          allow: coerceArray(access[partition]?.allow ?? access.allow),
          apiKeyId: coerceArray(access[partition]?.apiKeyId ?? access.apiKeyId),
          secretId: coerceArray(access[partition]?.secretId ?? access.secretId),
        };
      }
    }
    return attributes.accessConfig[partition];
  }

  getFetch() {
    if (!this.attributes.fetchContext) {
      // eslint-disable-next-line no-param-reassign
      this.attributes.fetchContext = keepAliveNoCache({
        userAgent: 'adobe-fetch', // static user-agent for recorded tests
      });
    }
    return this.attributes.fetchContext.fetch;
  }

  getFetchOptions(opts) {
    const fetchopts = {
      headers: {
        'cache-control': 'no-cache', // respected by runtime
      },
    };
    /* c8 ignore start */
    if (this.requestId) {
      fetchopts.headers['x-request-id'] = this.requestId;
    }
    if (this.githubToken) {
      fetchopts.headers['x-github-token'] = this.githubToken;
    }
    if (opts?.fetchTimeout) {
      fetchopts.signal = timeoutSignal(opts.fetchTimeout);
      delete fetchopts.fetchTimeout;
    }
    if (opts?.lastModified) {
      fetchopts.headers['if-modified-since'] = opts.lastModified;
      delete fetchopts.lastModified;
    }
    /* c8 ignore end */
    return fetchopts;
  }

  /**
   * Returns Google Client.
   *
   * @param {string} contentBusId content bus id
   * @returns {Promise<GoogleClient>} google client
   */
  async getGoogleClient(contentBusId) {
    const { attributes, env, log } = this;
    if (!attributes.google) {
      attributes.google = {};
    }
    if (!attributes.google[contentBusId]) {
      const { code: codeBucket, content: contentBucket } = attributes.bucketMap;
      const cachePlugin = await getCachePlugin({
        contentBusId,
        log,
        codeBucket,
        contentBucket,
      }, 'google');

      attributes.google[contentBusId] = await new GoogleClient({
        log,
        clientId: env.GOOGLE_HELIX_SERVICE_CLIENT_ID,
        clientSecret: env.GOOGLE_HELIX_SERVICE_CLIENT_SECRET,
        cachePlugin,
        googleApiOpts: attributes.googleApiOpts,
      }).init();
    }
    return attributes.google[contentBusId];
  }

  /**
   * Get or create a OneDrive client.
   *
   * @param {string} org org
   * @param {string} site site
   * @param {string} contentBusId content bus id
   * @param {string} tenant tenant id
   * @param {object} logFields log fields
   * @returns {Promise<OneDrive>} onedrive client
   */
  async getOneDriveClient(org, site, {
    contentBusId, tenant, logFields = {}, checkSourceLock = true,
  } = {}) {
    const { attributes, env, log } = this;
    if (!attributes.onedrive) {
      if (checkSourceLock) {
        await sourceLock.assert(this, org, site);
      }

      const { code: codeBucket, content: contentBucket } = attributes.bucketMap;
      const cachePlugin = await getCachePlugin({
        owner: org,
        contentBusId,
        log,
        codeBucket,
        contentBucket,
      }, 'onedrive');

      const auth = new OneDriveAuth({
        log,
        clientId: env.AZURE_HELIX_SERVICE_CLIENT_ID,
        clientSecret: env.AZURE_HELIX_SERVICE_CLIENT_SECRET,
        cachePlugin,
        tenant,
        acquireMethod: env.AZURE_HELIX_SERVICE_ACQUIRE_METHOD,
        logFields,
      });

      attributes.onedrive = new OneDrive({
        userAgent: APP_USER_AGENT,
        auth,
        log,
      });
    }
    return attributes.onedrive;
  }

  /**
   * Returns the next id used for logging the purge requests
   * @returns {number}
   */
  nextRequestId() {
    const { attributes } = this;

    attributes.subRequestId = (attributes.subRequestId || 0) + 1;
    return attributes.subRequestId;
  }

  /**
   * Return the content bus id of the config associated with this request.
   *
   * @returns {string} contentBusId
   */
  get contentBusId() {
    const { attributes: { config: { content: { contentBusId } } } } = this;
    return contentBusId;
  }
}

export function adminContext(func) {
  return async (request, context) => func(request, AdminContext.create(context, {
    headers: request.headers, attributes: context.attributes,
  }));
}
