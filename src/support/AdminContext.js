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
import { fetchS3 } from '@adobe/helix-admin-support';
import { IndexConfig, SitemapConfig } from '@adobe/helix-shared-config';
import { parseBucketNames } from '@adobe/helix-shared-storage';
import { getCachePlugin } from '@adobe/helix-shared-tokencache';
import { GoogleClient } from '@adobe/helix-google-support';
import { authorize } from '../auth/authzn.js';
import { getAuthInfo } from '../auth/support.js';
import { loadOrgConfig, loadSiteConfig } from '../config/utils.js';
import fetchRedirects from '../redirects/fetch.js';
import { StatusCodeError } from './StatusCodeError.js';
import sourceLock from './source-lock.js';
import { coerceArray } from './utils.js';
import { getOneDriveClient } from './onedrive.js';

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
    this.log = context.log || console;
    this.env = { ...context.env };

    ['data', 'runtime', 'func', 'invocation'].forEach((k) => {
      this[k] = context[k];
    });

    this.attributes = {
      errors: [],
      details: [],
      bucketMap: parseBucketNames(this.env.HELIX_BUCKET_NAMES),
      ...attributes,
    };

    this.requestId = headers?.get('x-request-id')
      || headers?.get('x-cdn-request-id')
      || '';
  }

  static create(context, opts) {
    return Object.freeze(new AdminContext(context, opts));
  }

  /**
   * Loads the site and org configuration.
   *
   * @param {import('./RequestInfo.js').RequestInfo} info info
   * @returns {Promise<object>} configuration
   */
  async loadConfig(info) {
    const { attributes } = this;

    if (attributes.config === undefined) {
      const { org, site } = info;
      if (org && site) {
        const config = await loadSiteConfig(this, org, site);
        if (config === null) {
          throw new StatusCodeError('', 404);
        }
        const { code: { owner, repo } } = config;
        info.withCode(owner, repo);

        attributes.config = config;
        attributes.orgConfig = null;
      } else if (org) {
        attributes.config = null;
        attributes.orgConfig = await loadOrgConfig(this, org);
      }
    }
    return attributes.config;
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

    await this.loadConfig(info);

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
    return authorize(this, info);
  }

  /**
   * Returns the normalized site access configuration for the current partition.
   *
   * @param {string} partition partition
   * @returns {Promise<object>} the access configuration for this partition
   */
  getSiteAccessConfig(partition) {
    const { attributes } = this;
    const { config } = attributes;

    if (!attributes.accessConfig?.[partition]) {
      if (!attributes.accessConfig) {
        attributes.accessConfig = {};
      }
      const access = config?.access;
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
    const key = contentBusId ?? 'default';
    if (!attributes.google[key]) {
      const { code: codeBucket, content: contentBucket } = attributes.bucketMap;
      const cachePlugin = await getCachePlugin({
        contentBusId,
        log,
        codeBucket,
        contentBucket,
      }, 'google');

      attributes.google[key] = await new GoogleClient({
        log,
        clientId: env.GOOGLE_HELIX_SERVICE_CLIENT_ID,
        clientSecret: env.GOOGLE_HELIX_SERVICE_CLIENT_SECRET,
        cachePlugin,
        googleApiOpts: attributes.googleApiOpts,
      }).init();
    }
    return attributes.google[key];
  }

  /**
   * Get or create a OneDrive client.
   *
   * @param {import('./RequestInfo').RequestInfo} info request info
   * @returns {Promise<OneDrive>} onedrive client
   */
  async getOneDriveClient(info) {
    const { config: { content: { contentBusId, source } }, attributes } = this;
    const { org, site, resourcePath } = info;

    if (!attributes.onedrive) {
      await sourceLock.assert(this, org, site);

      attributes.onedrive = await getOneDriveClient({
        bucketMap: attributes.bucketMap,
        org,
        contentBusId,
        tenant: source.tenantId,
        logFields: {
          project: `${org}/${site}`,
          operation: `${info.route} ${resourcePath}`,
        },
        env: this.env,
        log: this.log,
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
   * Returns the config associated with this request.
   */
  get config() {
    return this.attributes.config;
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

  /**
   * Retrieves the index configuration from the underlying storage and stores
   * it in the context as `indexConfig`.
   *
   * TODO: move to @adobe/helix-admin-support
   *
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @returns {Promise<IndexConfig>} the sitemap configuration
   */
  async fetchIndex(info) {
    const { attributes, contentBusId } = this;
    const { org, site } = info;

    if (attributes.indexConfig === undefined) {
      const key = `${contentBusId}/preview/.helix/query.yaml`;
      const response = await fetchS3(this, 'content', key);
      if (response.ok) {
        const text = await response.text();
        attributes.indexConfig = await new IndexConfig().withSource(text).init();
      } else if (response.status === 404) {
        attributes.indexConfig = null;
      } else {
        throw new StatusCodeError(`unable to load index configuration for ${org}/${site}`, response.status);
      }
    }
    return attributes.indexConfig;
  }

  /**
   * Retrieves the sitemap configuration from the underlying storage and stores
   * it in the context as `sitemapConfig`.
   *
   * TODO: move to @adobe/helix-admin-support
   *
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @returns {Promise<SitemapConfig>} the sitemap configuration
   */
  async fetchSitemap(info) {
    const { attributes, contentBusId } = this;
    const { org, site } = info;

    if (attributes.sitemapConfig === undefined) {
      const key = `${contentBusId}/preview/.helix/sitemap.yaml`;
      const response = await fetchS3(this, 'content', key);
      if (response.ok) {
        const text = await response.text();
        attributes.sitemapConfig = await new SitemapConfig().withSource(text).init();
      } else if (response.status === 404) {
        attributes.sitemapConfig = null;
      } else {
        throw new StatusCodeError(`unable to load sitemap configuration for ${org}/${site}`, response.status);
      }
    }
    return attributes.sitemapConfig;
  }

  /**
   * Ensures that the respective content-bus has the info marker that helps to identify the project.
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {import('@adobe/helix-shared-storage').Bucket} storage
   * @param {string} sourceUrl
   * @returns {Promise<void}
   */
  async ensureInfoMarker(info, storage, sourceUrl) {
    const { attributes, contentBusId } = this;
    const {
      org, site, owner, repo,
    } = info;

    if (!attributes.infoMarkerChecked) {
      // set container info if not present
      const infoKey = `${contentBusId}/.hlx.json`;
      const buf = await storage.get(infoKey);
      const meta = buf ? JSON.parse(buf) : {};

      let modified = false;
      if (!meta['original-repository']) {
        meta['original-repository'] = `${owner}/${repo}`;
        modified = true;
      }
      // for helix5 configs, we also store the original site
      if (!meta['original-site']) {
        if (modified) {
          // for new sites, use the current site information
          meta['original-site'] = `${org}/${site}`;
        } else {
          // for helix4 sites, use the original repo
          meta['original-site'] = meta['original-repository'];
          modified = true;
        }
      }

      if (!meta.mountpoint) {
        meta.mountpoint = sourceUrl;
        modified = true;
      }

      if (modified) {
        await storage.put(infoKey, Buffer.from(JSON.stringify(meta, null, 2)), 'application/json', meta, false);
      }
      attributes.infoMarkerChecked = true;
    }
  }
}

/**
 * Return a wrapper that creates an `AdminContext`.
 *
 * @param {function} func next function in chain
 * @returns {callback} callback to invoke
 */
export function adminContext(func) {
  return async (request, context) => {
    const wrappedContext = AdminContext.create(context, {
      headers: request.headers, attributes: context.attributes,
    });

    try {
      const response = await func(request, wrappedContext);
      return response;
    } finally {
      const { attributes } = wrappedContext;
      await attributes.onedrive?.dispose();
      attributes.storage?.close();
      await attributes.fetchContext?.reset();
    }
  };
}
