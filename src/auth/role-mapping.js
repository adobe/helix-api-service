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
/* eslint-disable max-len */
import { resolve } from 'path';
import { fetchConfigAll, getContentBusId } from '@adobe/helix-admin-support';
// import { ModifiersConfig } from '@adobe/helix-shared-config';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { coerceArray } from '../support/utils.js';

/**
 * the default role for legacy/simple access control setup.
 * for normal setup, the default role is empty.
 *
 * @type {string}
 */
const DEFAULT_ROLE_LEGACY = 'basic_publish';

/**
 * Loads a user sheet relative to the _current_ .helix/config.json.
 *
 * @param {AdminContext} ctx
 * @param {PathInfo} info
 * @param {string} relPath
 * @returns {Promise<[]>} array of users / user globs
 */
// async function loadUserSheet(ctx, info, relPath) {
//   // ignore group markers from helix5
//   if (relPath.startsWith('/groups/') || relPath.startsWith('groups/')) {
//     return [];
//   }

//   // make absolute to config location
//   const path = resolve('/.helix', relPath);

//   // load data from content-bus
//   const storage = HelixStorage.fromContext(ctx).contentBus();
//   const contentBusId = await getContentBusId(ctx, info);
//   let sheet = await storage.get(`${contentBusId}/preview${path}`);
//   if (!sheet) {
//     ctx.log.warn(`the user sheet referenced in the config does not exist: ${contentBusId}/preview${path}`);
//     return [];
//   }
//   ctx.log.info(`loaded user sheet from ${contentBusId}${path}`);

//   // return users
//   sheet = JSON.parse(sheet);
//   if (!sheet.default?.data?.length) {
//     ctx.log.warn(`the user sheet referenced in the config is empty: ${contentBusId}/preview${path}`);
//     return [];
//   }
//   return sheet.default.data.map((row) => ModifiersConfig.toLowerKeys(row).user);
// }

/**
 * Encapsulates the role mapping configuration.
 *
 * Role evaluation:
 * 1. If a request isn’t authenticated and requireAuth is true, a 401 status code is returned.
 * 2. If a request isn’t authenticated and requiredAuth is auto and role mapping is defined, a 401 status code is returned.
 * 3. If a request isn’t authenticated the defaultRole is used.
 * 4. If a request is authenticated and no role mapping is defined, or if requireAuth is false, the defaultRole is used.
 * 5. If a request is authenticated and role mapping is defined and requireAuth is not false, the roles that match the user are used.
 *   - If no mapping matches, the user will have no role; effectively always returning a 403 status code.
 *   - If several mapping matches, the user will have a combined set of roles
 */
export class RoleMapping {
  static async create(ctx, info, accessAdmin = {}, defaultRole = DEFAULT_ROLE_LEGACY) {
    const roleMapping = new RoleMapping()
      .withRequireAuth(accessAdmin.requireAuth)
      .withDefaultRoles(accessAdmin.defaultRole ?? defaultRole);

    const roles = Object.entries(accessAdmin.role ?? {});
    if (roles.length) {
      for (const [role, userEntry] of roles) {
        // eslint-disable-next-line no-await-in-loop
        const users = await roleMapping.resolveUsers(ctx, info, userEntry);
        for (const user of users) {
          roleMapping.add(role, user);
        }
      }
      roleMapping.hasConfigured = true;
    }
    return roleMapping;
  }

  static async load(ctx, info, defaultRole) {
    const configAll = await fetchConfigAll(ctx, { ...info, route: 'preview' });
    return RoleMapping.create(ctx, info, configAll?.config?.data?.admin, defaultRole);
  }

  constructor() {
    Object.assign(this, {
      defaultRoles: [],
      roles: new Map(),
      users: new Map(),
      sheets: new Map(),
      requireAuth: 'auto',
      hasConfigured: false,
    });
  }

  withDefaultRoles(roles) {
    this.defaultRoles = Array.isArray(roles)
      ? roles.sort()
      : [roles];
    return this;
  }

  getRolesForUser(...users) {
    // eslint-disable-next-line no-param-reassign
    users = users
      .filter((u) => !!u)
      .map((u) => u.toLowerCase());

    // if no roles configured (4) or if no user (3), add default roles
    if (!this.hasConfigured || users.length === 0) {
      return [...this.defaultRoles];
    }

    /** @type string[] */
    const roles = [];
    const globalRoles = this.users.get('*');
    if (globalRoles) {
      roles.push(...globalRoles);
    }

    for (const user of users) {
      const userRoles = this.users.get(user);
      if (userRoles) {
        roles.push(...userRoles);
      }

      const [, domain] = user.split('@');
      if (domain) {
        /** @type string[] */
        const wild = this.users.get(`*@${domain}`);
        if (wild) {
          roles.push(...wild);
        }
      }
    }

    // add default roles if auth is not required (4)
    if (this.requireAuth === 'false') {
      roles.push(...this.defaultRoles);
    }

    return [...new Set(roles)].sort();
  }

  getUsersForRole(role) {
    return this.roles.get(role) ?? [];
  }

  add(role, user) {
    if (!user) {
      return;
    }
    // eslint-disable-next-line no-param-reassign
    user = user.toLowerCase();
    let roles = this.users.get(user);
    if (!roles) {
      roles = [];
      this.users.set(user, roles);
    }
    if (!roles.includes(user)) {
      roles.push(role);
    }

    let users = this.roles.get(role);
    if (!users) {
      users = [];
      this.roles.set(role, users);
    }
    if (!users.includes(user)) {
      users.push(user);
    }
  }

  async resolveUsers(ctx, info, userEntry) {
    const users = [];
    for (const user of coerceArray(userEntry)) {
      if (user?.endsWith('.json')) {
        let sheetUsers = this.sheets.get(user);
        if (!sheetUsers) {
          // eslint-disable-next-line no-await-in-loop
          sheetUsers = await loadUserSheet(ctx, info, user);
          this.sheets.set(user, sheetUsers);
        }
        users.push(...sheetUsers);
      } else {
        users.push(user);
      }
    }
    return users;
  }

  withRequireAuth(requireAuth) {
    this.requireAuth = String(requireAuth ?? '').toLowerCase() || 'auto';
    return this;
  }
}
