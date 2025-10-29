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

import { AdminContext } from "../support/AdminContext.js";

/**
 * Path Info
 */
export declare interface AccessDeniedError extends Error {}

export declare interface OAuthClientConfig {
  clientID: string;
  clientSecret: string;
}

export declare interface AuthRoutes {
  loginRedirect:string;
  login:string;
}

export declare interface IDPConfig {
  name:string;
  scope:string;
  mountType:string;
  client(ctx: AdminContext):OAuthClientConfig;
  validateIssuer?(issuer: string): boolean;
  discoveryUrl:string;
  loginPrompt:string;
  discovery:any;
  routes:AuthRoutes;
}

export declare interface UserProfile {
  email:string;
  hlx_hash:string;
  picture:string;
  iss:string;
}

export declare interface AuthInfo {
  /**
   * Flag indicating of the request is authenticated
   */
  authenticated:boolean;

  /**
   * Checks if the assumed role has the given permissions
   * @param {string[]} permissions permissions to check
   * @return {boolean} {@code true} if it has the permissions
   */
  hasPermissions(...permissions:string[]): boolean;

  /**
   * Removes the given permissions
   * @param {string[]} permissions permissions to remove
   * @return {AuthInfo} this
   */
  removePermissions(...permissions:string[]): AuthInfo;

  /**
   * Checks if the assumed role has the given permissions
   * @param {string[]} permissions permissions to check
   * @throws {AccessDeniedError} if th role does not have the given permissions
   */
  assertPermissions(...permissions:string[]): void;

  /**
   * Returns the array of given permissions, optionally filtered by prefix.
   * @param {string} [prefix = ''] filter
   */
  getPermissions(prefix:string):string[];

  /**
   * Returns a json representation of the authentication info.
   */
  toJSON():object;

  profile?:UserProfile;

  expired?:boolean;

  loginHint?:string;

  idp?:IDPConfig;

  /**
   * Authentication done through the sidekick.
   */
  extensionId?:string;

  /**
   * Flag indicating that the auth cookie is invalid.
   */
  cookieInvalid?:boolean;

  /**
   * The IMS token embedded in the auth token.
   */
  imsToken?:string;
}
