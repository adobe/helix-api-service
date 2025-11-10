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
import getLiveInfo from './info.js';

/**
 * Retrieves the live status.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function liveStatus(ctx, info) {
  const live = await getLiveInfo(ctx, info);

  // return error if not 404
  if (live.status !== 200 && live.status !== 404) {
    return new Response('', {
      status: live.status,
      headers: {
        'x-error': live.error,
      },
    });
  }

  const resp = {
    webPath: info.webPath,
    resourcePath: info.resourcePath,
    live,
    // TODO links: getAPIUrls(ctx, info, 'status', 'preview', 'live', 'code'),
  };

  return new Response(JSON.stringify(resp, null, 2), {
    headers: {
      'content-type': 'application/json',
    },
  });
}
