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
import { AccessDeniedError } from './AccessDeniedError.js';
import { RoleMapping } from './role-mapping.js';
import { getAuthInfo } from './support.js';

/**
 * Authenticates current user. It checks if the request contains authentication information and
 * sets user data.
 **
 * @param {UniversalContext} ctx
 * @param {PathInfo} info
 * @returns {Promise<AuthInfo>} the authentication info
 */
export async function authenticate(ctx, info) {
  if (ctx.attributes.authInfo === undefined) {
    ctx.attributes.authInfo = await getAuthInfo(ctx, info);
  }
  return ctx.attributes.authInfo;
}

/**
 * Authorizes the current user by loading the project config and assigning the roles.
 *
 * @param {UniversalContext} ctx
 * @param {PathInfo} info
 * @throws AccessDeniedError if the user is not authorized
 */
export async function authorize(ctx, info) {
  const { log, attributes: { authInfo } } = ctx;
  if (!authInfo) {
    throw new AccessDeniedError('not authenticated');
  }

  // check if we have any roles or user in the invocation event itself
  if (ctx?.invocation?.event) {
    const { invocation: { event: { roles = [], user } } } = ctx;
    if (roles.length) {
      authInfo.withRoles(roles);
      if (user) {
        authInfo.withProfile({
          ...(authInfo.profile ?? {}),
          email: user,
        });
      }
      return;
    }
  }

  // load role mapping from config all
  const roleMapping = await RoleMapping.load(ctx, info, authInfo.profile?.defaultRole);

  const roles = roleMapping.getRolesForUser(
    authInfo.profile?.email,
    authInfo.profile?.user_id,
    authInfo.profile?.preferred_username,
  );
  authInfo.withRoles(roles);

  log.info(`auth: using roles ${roles} for ${authInfo.authenticated ? '' : 'un'}authenticated user`);

  // enforce authentication
  if (!authInfo.authenticated) {
    // if 'auto' configured and roles are defined (backward compat)
    if (roleMapping.requireAuth === 'auto') {
      if (roleMapping.hasConfigured) {
        throw new AccessDeniedError('not authenticated');
      }
    // or if auth is enforced
    } else if (roleMapping.requireAuth !== 'false') {
      throw new AccessDeniedError('not authenticated');
    }
  }
}
