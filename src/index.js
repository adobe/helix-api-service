/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import wrap from '@adobe/helix-shared-wrap';
import { Response } from '@adobe/fetch';
import bodyData from '@adobe/helix-shared-body-data';
import secrets from '@adobe/helix-shared-secrets';
import { helixStatus } from '@adobe/helix-status';

import { table } from './router/table.js';
import { adminContext } from './support/AdminContext.js';
import { RequestInfo } from './support/RequestInfo.js';
import { logRequest } from './support/utils.js';
import catchAll from './wrappers/catch-all.js';
import { contentEncodeWrapper } from './wrappers/content-encode.js';
import commonResponseHeaders from './wrappers/response-headers.js';

/**
 * Main entry point.
 *
 * @param {import('@adobe/fetch').Request} request request
 * @param {import('./support/AdminContext.js').AdminContext} context admin context
 * @returns {import('@adobe/fetch').Response} response
 */
async function run(request, context) {
  const { handler, variables } = table.match(context.suffix) ?? {};
  if (!handler) {
    return new Response('', { status: 404 });
  }
  const info = RequestInfo.create(request, variables);
  if (info.method === 'OPTIONS') {
    return new Response('', {
      status: 204,
      headers: {
        'access-control-allow-methods': 'GET, HEAD, POST, PUT, OPTIONS, DELETE',
        'access-control-allow-headers': 'Authorization, x-auth-token, x-content-source-authorization, content-type',
        'access-control-max-age': '86400',
      },
    });
  }

  await context.authenticate(info);
  await context.authorize(info);

  const { attributes: { authInfo } } = context;
  if (info.org && !authInfo.authenticated) {
    return new Response('', { status: 403 });
  }

  const response = await handler(context, info);
  logRequest(context, info, response);
  return response;
}

export const main = wrap(run)
  .with(catchAll)
  .with(adminContext)
  .with(commonResponseHeaders)
  .with(contentEncodeWrapper)
  .with(bodyData)
  .with(secrets)
  .with(helixStatus);
