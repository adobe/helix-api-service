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

import cache from './cache/handler.js';
import code from './code/handler.js';
import contentproxy from './contentproxy/handler.js';
import discover from './discover/handler.js';
import index from './index/handler.js';
import live from './live/handler.js';
import { auth, login, logout } from './login/handler.js';
import media from './media/handler.js';
import preview from './preview/handler.js';
import profile from './profile/handler.js';
import sitemap from './sitemap/handler.js';
import status from './status/handler.js';

import Router from './router/router.js';
import { adminContext } from './support/AdminContext.js';
import { RequestInfo } from './support/RequestInfo.js';
import catchAll from './wrappers/catch-all.js';
import { contentEncodeWrapper } from './wrappers/content-encode.js';
import commonResponseHeaders from './wrappers/response-headers.js';

/**
 * Dummy NYI handler
 * @returns {Response} response
 */
const notImplemented = () => new Response('', { status: 405 });

/**
 * Name selector for routes.
 */
const nameSelector = (segs) => {
  const literals = segs.filter((seg) => seg !== '*' && !seg.startsWith(':'));
  if (literals.length === 0) {
    return 'org';
  }
  if (literals.at(0) === 'sites' && literals.length > 1) {
    literals.shift();
  }
  return literals.join('-');
};

/**
 * Routing table.
 */
export const router = new Router(nameSelector)
  .add('/auth/*', auth)
  .add('/discover', discover)
  .add('/login', login)
  .add('/logout', logout)
  .add('/profile', profile)
  .add('/:org', notImplemented)
  .add('/:org/config', notImplemented)
  .add('/:org/config/access', notImplemented)
  .add('/:org/config/versions', notImplemented)
  .add('/:org/profiles', notImplemented)
  .add('/:org/profiles/:profile/versions', notImplemented)
  .add('/:org/sites', notImplemented)
  .add('/:org/sites/:site/status/*', status)
  .add('/:org/sites/:site/config', notImplemented)
  .add('/:org/sites/:site/config/da', notImplemented)
  .add('/:org/sites/:site/config/sidekick', notImplemented)
  .add('/:org/sites/:site/config/access', notImplemented)
  .add('/:org/sites/:site/config/versions', notImplemented)
  .add('/:org/sites/:site/contentproxy/*', contentproxy)
  .add('/:org/sites/:site/preview/*', preview)
  .add('/:org/sites/:site/live/*', live)
  .add('/:org/sites/:site/login', login)
  .add('/:org/sites/:site/media/*', media)
  .add('/:org/sites/:site/code/:ref/*', code)
  .add('/:org/sites/:site/cache/*', cache)
  .add('/:org/sites/:site/index/*', index)
  .add('/:org/sites/:site/sitemap/*', sitemap)
  .add('/:org/sites/:site/snapshots/*', notImplemented)
  .add('/:org/sites/:site/source/*', notImplemented)
  .add('/:org/sites/:site/jobs', notImplemented)
  .add('/:org/sites/:site/log', notImplemented);

/**
 * Main entry point.
 *
 * @param {import('@adobe/fetch').Request} request request
 * @param {import('./support/AdminContext.js').AdminContext} context admin context
 * @returns {import('@adobe/fetch').Response} response
 */
async function run(request, context) {
  const { handler, variables } = router.match(context.suffix) ?? {};
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

  const { suffix, log } = context;
  const response = await handler(context, info);
  const admin = {
    method: info.method,
    route: info.route,
    path: info.webPath,
    suffix,
    status: response.status,
  };
  ['org', 'site'].forEach((key) => {
    if (info[key]) {
      admin[key] = info[key];
    }
  });
  log.info('%j', { admin });
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
