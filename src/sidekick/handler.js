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
import { getConfigJsonResponse } from './utils.js';

/**
 * Handles the sidekick route
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function sidekickHandler(context, info) {
  const { attributes: { authInfo } } = context;

  if (info.method !== 'GET') {
    return new Response('method not allowed', {
      status: 405,
    });
  }

  authInfo.assertPermissions('code:read');
  const { sidekick } = await getConfigJsonResponse(context, info);

  return new Response(JSON.stringify(sidekick), {
    headers: {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
