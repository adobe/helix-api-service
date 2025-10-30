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
import { Response } from '@adobe/fetch';
import { LOGIN_PATH, LOGOUT_PATH } from '../auth/support.js';

const ALLOWED_METHODS = ['GET', 'POST'];

/**
 * Handles the /me route
 * @param {AdminContext} context the universal context
 * @param {PathInfo} info path info
 * @returns {Promise<Response>} response
 */
export default async function profileHandler(context, info) {
  if (ALLOWED_METHODS.indexOf(info.method) < 0) {
    return new Response('method not allowed', {
      status: 405,
    });
  }

  // send 401 if not authenticated
  const { attributes: { authInfo } } = context;
  const { profile } = authInfo;
  if (!profile) {
    const data = {
      status: 401,
      error: 'unauthorized',
      links: {
        login: info.getLinkUrl(LOGIN_PATH),
      },
    };
    return new Response(JSON.stringify(data, null, 2), {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'x-error': 'not authenticated.',
      },
    });
  }

  const data = {
    status: 200,
    profile,
    links: {
      logout: info.getLinkUrl(LOGOUT_PATH),
    },
  };

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
