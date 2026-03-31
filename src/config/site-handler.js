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
import { BaseHandler } from './handler.js';
import { ContentStore, CONFIG_TYPES } from './content-store.js';
import { createErrorResponse } from '../contentbus/utils.js';

class SiteHandler extends BaseHandler {
  constructor() {
    super('sites', { supportsApiKeys: true });
  }

  determineConfigType(info) {
    const { rawPath, site } = info;
    if (rawPath === undefined) {
      return {
        type: this.type, name: site,
      };
    }
    const [, ...rest] = rawPath.substring(0, rawPath.length - 5).split('/');
    return { type: this.type, name: site, rest };
  }

  /**
   * Handle YAML content requests.
   *
   * @param {import('../support/AdminContext').AdminContext} context
   * @param {import('../support/RequestInfo').RequestInfo} info
   * @param {string} op one of the OPERATIONS
   * @returns {Promise<Response>} response
   */
  // eslint-disable-next-line class-methods-use-this
  async handleYAML(context, info, op) {
    const { contentBusId, log } = context;
    const { rawPath } = info;

    const [, ...rest] = rawPath.substring(0, rawPath.length - 5).split('/');
    const type = rest.join('/');

    const config = CONFIG_TYPES[type];
    if (!config) {
      return createErrorResponse({ log, status: 404, msg: 'invalid config type' });
    }
    return new ContentStore(type, contentBusId)[op](context, info);
  }

  async doHandle(context, info, op) {
    const { rawPath, ext } = info;
    if (ext === '.yaml') {
      return this.handleYAML(context, info, op);
    }
    if (rawPath === '/robots.txt') {
      return this.handleRobots(context, info, op);
    }
    return super.doHandle(context, info, op);
  }
}

const siteHandler = new SiteHandler();
export default siteHandler.handle.bind(siteHandler);
