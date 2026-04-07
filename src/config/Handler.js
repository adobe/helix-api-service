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
import { AdminConfigStore } from './AdminConfigStore.js';
import { errorResponse } from '../support/utils.js';
import { createErrorResponse } from '../contentbus/utils.js';
import { createAdminJWT } from './utils.js';

const OPERATIONS = {
  PUT: 'fetchCreate',
  GET: 'fetchRead',
  POST: 'fetchUpdate',
  DELETE: 'fetchRemove',
};

export class BaseHandler {
  constructor(type, { permissions = ['config:read'], supportsApiKeys = false, supportsRobots = false } = {}) {
    this.type = type;
    this.permissions = permissions;
    this.supportsApiKeys = supportsApiKeys;
    this.supportsRobots = supportsRobots;
  }

  /**
   * Determines the configuration type and additional parameters based on the
   * incoming request information; interprets the request path and file extension
   * to resolve which config is being targeted
   *
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {string} [info.rawPath] raw path from the request URL (may be undefined)
   * @param {string} [info.route] route portion of the request
   * @param {string} [info.ext] extension of the requested file
   * @returns {{type?: string, name?: string, rest: string[]}} object describing
   *   the config type, optional config name, and the remaining path parts
   * @abstract
   */
  /* c8 ignore next 4 */
  // eslint-disable-next-line class-methods-use-this
  determineConfigType() {
    throw new Error('not implemented');
  }

  async handleJSON(context, info, op) {
    const { attributes: { authInfo }, data } = context;
    const { org } = info;

    const { type, name, rest = [] } = this.determineConfigType(info);
    const store = new AdminConfigStore(org, type, name)
      .withAllowOps(authInfo.hasPermissions('config:ops'))
      .withAllowAdmin(authInfo.hasPermissions('config:admin-acl'));

    if (this.supportsApiKeys && op === 'fetchUpdate' && rest.at(-1) === 'apiKeys') {
      // only allow admins to set api keys
      authInfo.assertPermissions('config:admin-acl');
      if (!data.jwt) {
        data.jwt = await createAdminJWT(context, org, name, data.roles);
      }
    }

    const relPath = rest.join('/');
    return store[op](context, relPath);
  }

  async handleRobots(context, info, op) {
    const { data, log } = context;
    const { org, site } = info;

    if (op === 'fetchUpdate') {
      if (!data.body) {
        return createErrorResponse({ log, status: 400, msg: 'missing body' });
      }
      data.txt = data.body;
      delete data.body;
    }
    const store = new AdminConfigStore(org, this.type, site);
    let response = await store[op](context, 'robots');
    if (op !== 'fetchRemove' && response.status === 200) {
      const json = await response.json();
      response = new Response(json.txt, {
        headers: { 'content-type': 'text/plain' },
      });
    }
    return response;
  }

  async doHandle(context, info, op) {
    const { log } = context;
    const { rawPath, ext } = info;

    if (this.supportsRobots && info.rawPath === '/robots.txt') {
      return this.handleRobots(context, info, op);
    }
    if (rawPath === undefined || ext === '.json') {
      return this.handleJSON(context, info, op);
    }
    return errorResponse(log, 404, 'invalid config type');
  }

  async handle(context, info) {
    const { attributes: { authInfo }, log } = context;
    const { method } = info;

    const op = OPERATIONS[method];
    if (!op) {
      return errorResponse(log, 405, 'method not allowed');
    }
    if (op !== 'fetchRead') {
      authInfo.assertPermissions('config:write');
    } else {
      authInfo.assertAnyPermission(...this.permissions);
    }
    return this.doHandle(context, info, op);
  }
}
