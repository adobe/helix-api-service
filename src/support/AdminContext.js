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
import { AuthInfo } from '../auth/AuthInfo.js';
import { loadOrgConfig, loadSiteConfig } from '../config/utils.js';
import { StatusCodeError } from './StatusCodeError.js';

export class AdminContext {
  /**
   * @constructs AdminContext
   * @param {import('@adobe/helix-universal').UniversalContext} context universal context
   * @param {import('@adobe/fetch').Headers} [headers] headers
   */
  constructor(context, headers) {
    this.suffix = context.pathInfo.suffix;
    this.log = context.log;
    this.env = context.env;

    this.attributes = {
      errors: [],
      details: [],
      bucketMap: parseBucketNames(this.env.HELIX_BUCKET_NAMES),
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

  async getConfig(info) {
    if (this.attributes.config === undefined) {
      const { org, site } = info;
      if (org && site) {
        const config = await loadSiteConfig(this, org, site);
        if (config === null) {
          throw new StatusCodeError('', 404);
        }
        this.attributes.config = config;
      } else {
        this.attributes.config = null;
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
      } else {
        this.attributes.orgConfig = null;
      }
    }
    return this.attributes.orgConfig;
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
    // eslint-disable-next-line no-unused-vars
    const config = await this.getConfig(info);

    if (this.attributes.authInfo === undefined) {
      // TODO: ctx.attributes.authInfo = await getAuthInfo(context, info);
      return AuthInfo.Basic();
    }
    /* c8 ignore next */
    return this.attributes.authInfo;
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

    // TODO: evaluate roles
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
}

export function adminContext(func) {
  return async (request, context) => func(request, new AdminContext(context, request.headers));
}
