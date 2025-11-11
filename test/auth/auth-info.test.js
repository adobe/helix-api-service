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

/* eslint-env mocha */
import assert from 'assert';
import { AccessDeniedError } from '../../src/auth/AccessDeniedError.js';
import { AuthInfo } from '../../src/auth/auth-info.js';

describe('AuthInfo Test', () => {
  it('auth info can assert for permissions', async () => {
    const authInfo = new AuthInfo()
      .withRole('publish');
    authInfo.assertPermissions('live:read');
    assert.throws(() => authInfo.assertPermissions('system:exit'), new AccessDeniedError('system:exit'));

    authInfo.assertAnyPermission('live:read', 'system:exit');
    assert.throws(() => authInfo.assertAnyPermission('system:exit', 'config:read'), new AccessDeniedError('system:exit or config:read'));
  });

  it('auth info can filter permissions', async () => {
    const authInfo = new AuthInfo()
      .withRole('admin');
    assert.deepStrictEqual(authInfo.getPermissions('live:'), ['delete', 'delete-forced', 'list', 'read', 'write']);
  });

  it('auth info can remove permissions', async () => {
    const authInfo = new AuthInfo()
      .withRole('publish')
      .removePermissions('live:read', 'preview:read');

    assert.deepStrictEqual(authInfo.getPermissions(), [
      'cache:write',
      'code:delete',
      'code:read',
      'code:write',
      'cron:read',
      'cron:write',
      'discover:peek',
      'edit:list',
      'edit:read',
      'index:read',
      'index:write',
      'job:list',
      'job:read',
      'job:write',
      'live:delete',
      'live:delete-forced',
      'live:list',
      'live:write',
      'log:read',
      'preview:delete',
      'preview:delete-forced',
      'preview:list',
      'preview:write',
      'snapshot:delete',
      'snapshot:read',
      'snapshot:write',
    ]);
  });
});
