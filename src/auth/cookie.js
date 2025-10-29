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
import { parse, serialize } from 'cookie';

export function clearAuthCookie(info) {
  return serialize('auth_token', '', {
    path: info.functionPath || '/',
    httpOnly: true,
    secure: true,
    expires: new Date(0),
    sameSite: 'Strict',
  });
}

export function setAuthCookie(info, token) {
  return serialize('auth_token', token, {
    path: info.functionPath || '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
  });
}

export function getAuthCookie(info) {
  // add cookies if not already present
  if (!info.cookies) {
    const hdr = info.headers.cookie;
    // eslint-disable-next-line no-param-reassign
    info.cookies = hdr ? parse(hdr) : {};
  }
  return info.cookies.auth_token;
}
