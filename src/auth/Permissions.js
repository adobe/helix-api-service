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
export const PERMISSIONS = {};

PERMISSIONS.all = [
  'cache:write',
  'code:read',
  'code:write',
  'code:delete',
  'code:delete-forced',
  'config:read',
  'config:read-redacted',
  'config:write',
  'config:admin-acl',
  'index:read',
  'index:write',
  'preview:read',
  'preview:write',
  'preview:delete',
  'preview:delete-forced',
  'preview:list',
  'edit:read',
  'edit:list',
  'live:read',
  'live:write',
  'live:delete',
  'live:delete-forced',
  'live:list',
  'cron:read',
  'cron:write',
  'discover:peek',
  'discover:read',
  'discover:write',
  'discover:list',
  'snapshot:read',
  'snapshot:write',
  'snapshot:delete',
  'psi:execute',
  'job:test',
  'job:read',
  'job:write',
  'job:list',
  'log:read',
  'log:write',
].sort();

PERMISSIONS.admin = PERMISSIONS.all;

PERMISSIONS.ops = [
  ...PERMISSIONS.all,
  'config:ops',
  'media:upload',
].sort();

/**
 * minimal authoring permissions for anonymous
 * @type {string[]}
 */
PERMISSIONS.basic_author = [
  'cache:write',
  'code:read',
  'code:write',
  'code:delete',
  'index:read',
  'index:write',
  'preview:read',
  'preview:write',
  'preview:delete',
  'edit:read',
  'live:read',
  'cron:read',
  'cron:write',
  'discover:peek',
  'snapshot:read',
  'job:read',
].sort();

/**
 * minimal publish permissions for anonymous
 * @type {string[]}
 */
PERMISSIONS.basic_publish = [
  ...PERMISSIONS.basic_author,
  'live:write',
  'live:delete',
].sort();

PERMISSIONS.author = [
  ...PERMISSIONS.basic_author,
  'edit:list',
  'job:list',
  'log:read',
  'preview:list',
  'preview:delete-forced',
  'snapshot:delete',
  'snapshot:write',
  'job:write',
].sort();

PERMISSIONS.publish = [
  ...PERMISSIONS.author,
  'live:write',
  'live:delete',
  'live:delete-forced',
  'live:list',
].sort();

PERMISSIONS.develop = [
  ...PERMISSIONS.author,
  'code:write',
  'code:delete',
  'code:delete-forced',
].sort();

/**
 * define default permissions (not role)
 * @type {string[]}
 */
const PERMISSIONS_DEFAULT = [
  'edit:read',
  'code:read',
  'index:read',
  'preview:read',
  'live:read',
  'discover:peek',
  'snapshot:read',
].sort();

PERMISSIONS.index = [
  ...PERMISSIONS_DEFAULT,
  'index:write',
  'discover:read',
  'discover:write',
].sort();

PERMISSIONS.code = [
  ...PERMISSIONS_DEFAULT,
  'code:write',
  'code:delete',
  'code:delete-forced',
  'psi:execute',
  'job:read',
  'job:write',
  'job:list',
].sort();

PERMISSIONS.config_admin = [
  ...PERMISSIONS.publish,
  'config:write',
  'config:read',
].sort();

PERMISSIONS.config = [
  'config:read-redacted',
].sort();

PERMISSIONS.media_author = [
  'media:upload',
];

// internal roles for site auth
PERMISSIONS.site_preview = [
  'preview:read',
];
PERMISSIONS.site_live = [
  'live:read',
];
