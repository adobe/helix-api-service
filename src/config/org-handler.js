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

const NAMES = [
  'versions',
  'tokens',
  'secrets',
  'users',
  'access',
  'groups',
  'apiKeys',
];

class OrgHandler extends BaseHandler {
  constructor() {
    super('org', { supportsApiKeys: true });
  }

  /**
   * Determines the configuration type and additional parameters based on the
   * incoming request information; interprets the request path and file extension
   * to resolve which organizational config is being targeted
   *
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {string} [info.rawPath] raw path from the request URL (may be undefined)
   * @param {string} [info.route] route portion of the request
   * @param {string} [info.ext] extension of the requested file
   * @returns {{type?: string, name?: string, rest: string[]|null}} object describing
   *   the config type, optional config name, and the remaining path parts;
   *   returns `{ rest: null }` if the type could not be determined
   */
  determineConfigType(info) {
    const { rawPath, route, ext } = info;
    if (rawPath === undefined) {
      // either a request to the org config itself or its sites or its profiles
      const type = route !== 'config.json' ? route : this.type;
      return { type };
    }
    if (ext === '.json') {
      const [, name, ...rest] = rawPath.substring(0, rawPath.length - 5).split('/');
      if (NAMES.includes(name)) {
        rest.unshift(name);
        return { type: this.type, name: '', rest };
      } else {
        // TODO: there never seems to be a sub type not present in NAMES
        return { type: this.type, name, rest };
      }
    }
    return { rest: null };
  }
}

const orgHandler = new OrgHandler();
export default orgHandler.handle.bind(orgHandler);
