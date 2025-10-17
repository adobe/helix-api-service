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
import timing from '@adobe/helix-shared-server-timing';
import { cleanupHeaderValue } from '@adobe/helix-shared-utils';
import { helixStatus } from '@adobe/helix-status';

import login from './login/handler.js';
import status from './status/handler.js';
import Router from './router/router.js';
import { adminContext } from './support/AdminContext.js';
import { RequestInfo } from './support/RequestInfo.js';
import { AccessDeniedError } from './auth/AccessDeniedError.js';
import { StatusCodeError } from './support/StatusCodeError.js';

/**
 * Dummy NYI handler
 * @returns {Response} response
 */
const notImplemented = () => new Response('', { status: 405 });

/**
 * Routing table.
 */
const router = new Router()
  .add('/login', login)
  .add('/logout', notImplemented)
  .add('/profile', notImplemented)
  .add('/:org', notImplemented)
  .add('/:org/config', notImplemented)
  .add('/:org/config/access', notImplemented)
  .add('/:org/config/versions', notImplemented)
  .add('/:org/profiles', notImplemented)
  .add('/:org/profiles/:profile/versions', notImplemented)
  .add('/:org/sites', notImplemented)
  .add('/:org/sites/:site/status/*', status)
  .add('/:org/sites/:site/config/da', notImplemented)
  .add('/:org/sites/:site/config/sidekick', notImplemented)
  .add('/:org/sites/:site/config/access', notImplemented)
  .add('/:org/sites/:site/config/versions', notImplemented)
  .add('/:org/sites/:site/preview/*', notImplemented)
  .add('/:org/sites/:site/live/*', notImplemented)
  .add('/:org/sites/:site/media/*', notImplemented)
  .add('/:org/sites/:site/code/:branch/*', notImplemented)
  .add('/:org/sites/:site/cache/*', notImplemented)
  .add('/:org/sites/:site/index/*', notImplemented)
  .add('/:org/sites/:site/sitemap/*', notImplemented)
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
  await context.authenticate(info);
  await context.authorize(info);
  return handler(context, info);
}

/**
 * Catch all link that will turn exceptions into responses.
 *
 * @param {function} func next function in chain
 * @returns {callback} callback to invoke
 */
function catchAll(func) {
  return async (request, context) => {
    try {
      const response = await func(request, context);
      return response;
    } catch (e) {
      const { log, attributes: { authInfo } } = context;
      /* c8 ignore next 22 */
      if (e instanceof AccessDeniedError) {
        if (authInfo.authenticated) {
          log.warn(`request authenticated but needs permissions: ${e.message}`);
          return new Response('', {
            status: 403,
            headers: {
              'x-error': 'not authorized',
            },
          });
        }
        log.warn(`request not authenticated but needs permissions: ${e.message}`);
        return new Response('', {
          status: 401,
          headers: {
            'x-error': 'not authenticated',
          },
        });
      }
      return new Response('', {
        status: e.status || e.statusCode || e.$metadata?.httpStatusCode || 500,
        headers: {
          'x-error': cleanupHeaderValue(e instanceof StatusCodeError ? e.message : e.toString()),
        },
      });
    }
  };
}

export const main = wrap(run)
  .with(catchAll)
  .with(adminContext)
  .with(timing)
  .with(bodyData)
  .with(secrets)
  .with(helixStatus);
