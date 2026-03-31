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
import { Response } from '@adobe/fetch';
import { getMergedConfig } from '@adobe/helix-config-storage';
import { createErrorResponse } from '../contentbus/utils.js';
import { AdminConfigStore } from './admin-config-store.js';
import { BaseHandler } from './handler.js';

class AggregatedHandler extends BaseHandler {
  constructor() {
    super('aggregated', { permissions: ['config:read', 'config:read-redacted'] });
  }

  // eslint-disable-next-line class-methods-use-this
  async getAggregatedSite(context, org, site) {
    const { attributes: { authInfo } } = context;
    const isRedacted = !authInfo.hasPermissions('config:read');

    const sitesStore = new AdminConfigStore(org, 'sites', site);
    sitesStore.setRedacted(isRedacted);

    const response = await sitesStore.fetchRead(context, '');
    // we may get other than json responses, e.g. 404 et al.
    if (!response.ok) {
      return null;
    }
    let siteConfig = await response.json();

    // extend from profile
    const profileConfigStore = new AdminConfigStore(org, 'profiles', siteConfig.extends?.profile || 'default');
    profileConfigStore.setRedacted(isRedacted);
    const profileResponse = await profileConfigStore.fetchRead(context, '');
    if (profileResponse.ok) {
      const profile = await profileResponse.json();
      siteConfig = getMergedConfig(siteConfig, profile);
    }
    return siteConfig;
  }

  async handleJSON(context, info) {
    const { log } = context;
    const { org, site } = info;

    const siteConfig = await this.getAggregatedSite(context, org, site);
    if (!siteConfig) {
      return createErrorResponse({ log, status: 404, msg: 'no such config' });
    }
    return new Response(siteConfig);
  }

  async handleRobots(context, info) {
    const { log } = context;
    const { org, site } = info;

    const siteConfig = await this.getAggregatedSite(context, org, site);
    const robots = siteConfig?.robots?.txt;
    if (!robots) {
      return createErrorResponse({ log, status: 404, msg: 'no such config' });
    }
    return new Response(robots, {
      headers: { 'content-type': 'text/plain' },
    });
  }

  async doHandle(context, info, op) {
    const { log } = context;
    const { route } = info;

    if (op !== 'fetchRead') {
      return createErrorResponse({ log, status: 405, msg: 'method not allowed' });
    }
    if (route?.endsWith('robots.txt')) {
      return this.handleRobots(context, info);
    }
    return super.doHandle(context, info, op);
  }
}

const aggregatedHandler = new AggregatedHandler();
export default aggregatedHandler.handle.bind(aggregatedHandler);
