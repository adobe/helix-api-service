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
import { PERMISSIONS } from './Permissions.js';
import { AccessDeniedError } from './AccessDeniedError.js';

// the 'aud' claim in a bearer token needs to match our client id (exported for testing)
export const ADMIN_CLIENT_ID = '452733d4-6ae5-4590-8d0f-27404a03aca8';

// the 'aud' claim in a api key token needs to match our client id (exported for testing)
export const SITE_CLIENT_ID = '83a36355-ad17-4ed0-8701-e99a3020f86a';

/* c8 ignore start */
export class AuthInfo {
  static Admin() {
    return new AuthInfo()
      .withProfile({
        userId: 'admin',
      })
      .withRole('admin');
  }

  static Default() {
    return new AuthInfo()
      .withAuthenticated(false);
  }

  /**
   * mainly used for testing
   * @return {AuthInfo}
   * @constructor
   */
  static Basic() {
    return new AuthInfo()
      .withRole('basic_publish')
      .withAuthenticated(false);
  }

  constructor() {
    Object.assign(this, {
      roles: new Set(),
      permissions: new Set(),
      authenticated: false,
      idp: null,
      profile: null,
      loginHint: null,
      expired: false,
      cookieInvalid: false,
      authToken: null,
      extensionId: null,
      imsToken: null,
    });
  }

  withPermissions(perms) {
    perms.forEach((p) => this.permissions.add(p));
    return this;
  }

  withRole(role) {
    const perms = PERMISSIONS[role];
    if (perms) {
      this.roles.add(role);
      this.withPermissions(perms);
    }
    return this;
  }

  withRoles(roles) {
    for (const role of roles) {
      this.withRole(role);
    }
    return this;
  }

  withAuthenticated(value) {
    this.authenticated = value;
    return this;
  }

  withProfile(profile) {
    this.profile = profile;

    if (profile.aud === ADMIN_CLIENT_ID || profile.aud === SITE_CLIENT_ID) {
      if (Array.isArray(profile.roles)) {
        this.withRoles(profile.roles);
      }
      if (Array.isArray(profile.scopes)) {
        this.withPermissions(profile.scopes);
      }
    }
    return this;
  }

  withIdp(value) {
    this.idp = value;
    return this;
  }

  withCookieInvalid(value) {
    this.cookieInvalid = value;
    return this;
  }

  withAuthToken(value) {
    this.authToken = value;
    return this;
  }

  withExtensionId(value) {
    this.extensionId = value;
    return this;
  }

  withImsToken(value) {
    this.imsToken = value;
    return this;
  }

  hasPermissions(...permissions) {
    return permissions.every((p) => this.permissions.has(p));
  }

  assertPermissions(...permissions) {
    if (!this.hasPermissions(...permissions)) {
      throw new AccessDeniedError(permissions.join());
    }
  }

  assertAnyPermission(...permissions) {
    if (!permissions.some((p) => this.permissions.has(p))) {
      throw new AccessDeniedError(permissions.join(' or '));
    }
  }

  getPermissions(prefix = '') {
    const perms = Array.from(this.permissions.values()).sort();
    if (prefix) {
      return perms.map((perm) => {
        if (perm.startsWith(prefix)) {
          return perm.substring(prefix.length);
        }
        return '';
      })
        .filter((perm) => !!perm);
    }
    return perms;
  }

  removePermissions(...permissions) {
    for (const perm of permissions) {
      this.permissions.delete(perm);
    }
    return this;
  }

  /**
   * Resolves the email of the profile user by returning either the `email`, `user_id`,
   * `preferred_username` or undefined.
   * @returns {undefined|string} the email of the user
   */
  resolveEmail() {
    return this.profile?.email
      || this.profile?.user_id
      || this.profile?.preferred_username;
  }

  toJSON() {
    return {
      authenticated: this.authenticated,
      roles: Array.from(this.roles.values()).sort(),
      permissions: this.getPermissions(),
      idp: this.idp?.name,
      profile: this.profile,
      expired: this.expired,
      loginHint: this.loginHint,
    };
  }
}
/* c8 ignore end */
