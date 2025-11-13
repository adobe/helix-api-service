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
import {
  clearAuthCookie, getAuthCookie, setAuthCookie,
} from '../../src/auth/cookie.js';

describe('Auth Cookie Test', () => {
  it('clears the auth cookie', () => {
    assert.strictEqual(clearAuthCookie({}), 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict');
  });

  it('sets the auth cookie', () => {
    assert.strictEqual(
      setAuthCookie('token'),
      'auth_token=token; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('gets the auth cookie', () => {
    const info = {
      cookies: {
        auth_token: 'token',
      },
    };
    assert.strictEqual(getAuthCookie(info), 'token');

    const { cookies } = info;
    getAuthCookie(info);
    assert.strictEqual(cookies, info.cookies, 'info.cookies should not be parsed twice');
  });
});
