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

  /**
   * Determines the configuration type and additional parameters based on the
   * incoming request information; interprets the request path and file extension
   * to resolve which site config is being targeted
   *
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {string} [info.rawPath] raw path from the request URL (may be undefined)
   * @param {string} [info.ext] extension of the requested file
   * @param {string} [info.site] site name
   * @returns {{type?: string, name?: string, rest: string[]|null}} object describing
   *   the config type, optional config name, and the remaining path parts;
   *   returns `{ rest: null }` if the type could not be determined
   */
  determineConfigType(info) {
    const { rawPath, ext, site } = info;
    if (rawPath === undefined) {
      return {
        type: this.type, name: site,
      };
    }
    if (ext === '.json') {
      const [, ...rest] = rawPath.substring(0, rawPath.length - 5).split('/');
      return { type: this.type, name: site, rest };
    }
    return { rest: null };
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
      return createErrorResponse({ log, status: 400, msg: 'invalid config type' });
    }
    return new ContentStore(type, contentBusId)[op](context, info);
  }

  async doHandle(context, info, op) {
    const { ext } = info;
    if (ext === '.yaml') {
      return this.handleYAML(context, info, op);
    }
    return super.doHandle(context, info, op);
  }
}

const siteHandler = new SiteHandler();
export default siteHandler.handle.bind(siteHandler);
