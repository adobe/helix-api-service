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
import { cleanupHeaderValue } from '@adobe/helix-shared-utils';
import { helixStatus } from '@adobe/helix-status';

import cache from './cache/handler.js';
import code from './code/handler.js';
import { auth, login, logout } from './login/handler.js';
import media from './media/handler.js';
import profile from './profile/handler.js';
import status from './status/handler.js';

import { AccessDeniedError } from './auth/AccessDeniedError.js';
import Router from './router/router.js';
import { adminContext } from './support/AdminContext.js';
import { RequestInfo } from './support/RequestInfo.js';
import { StatusCodeError } from './support/StatusCodeError.js';
import { contentEncodeWrapper } from './support/content-encode.js';

/**
 * Dummy NYI handler
 * @returns {Response} response
 */
const notImplemented = () => new Response('', { status: 405 });

/**
 * Routing table.
 */
export const router = new Router()
  .add('/auth/*', auth)
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
  .add('/:org/sites/:site/config/da', notImplemented)
  .add('/:org/sites/:site/config/sidekick', notImplemented)
  .add('/:org/sites/:site/config/access', notImplemented)
  .add('/:org/sites/:site/config/versions', notImplemented)
  .add('/:org/sites/:site/preview/*', notImplemented)
  .add('/:org/sites/:site/live/*', notImplemented)
  .add('/:org/sites/:site/login', login)
  .add('/:org/sites/:site/media/*', media)
  .add('/:org/sites/:site/code/:ref/*', code)
  .add('/:org/sites/:site/cache/*', cache)
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
      /* c8 ignore start */
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
      if (e instanceof TypeError) {
        log.warn(e);
      }
      return new Response('', {
        status: e.status || e.statusCode || e.$metadata?.httpStatusCode || 500,
        headers: {
          'x-error': cleanupHeaderValue(e instanceof StatusCodeError ? e.message : e.toString()),
        },
      });
      /* c8 ignore end */
    }
  };
}

/**
 * Wrapper to add common Response headers
 * @param {UniversalAction} fn
 * @returns {function(Request, UniversalContext): Promise<Response>}
 */
function addCommonResponseHeadersWrapper(fn) {
  return async (req, context) => {
    const res = await fn(req, context);
    if (!res.headers.has('cache-control')) {
      res.headers.set('cache-control', 'no-store, private, must-revalidate');
    }

    // add CORS headers if origin is present
    const origin = req.headers.get('origin');
    if (origin) {
      // echo the requested origin back to the client. You may like to
      // check this against a whitelist of origins instead of blindly
      // allowing potentially destructive requests from any origin
      res.headers.set('access-control-allow-origin', origin);

      // The Access-Control-Allow-Credentials response header tells browsers whether
      // to expose the response to the frontend JavaScript code when the request's
      // credentials mode (Request.credentials) is include.
      res.headers.set('access-control-allow-credentials', 'true');

      // The Access-Control-Expose-Headers response header allows a server to
      // indicate which response headers should be made available to scripts
      // running in the browser, in response to a cross-origin request.
      res.headers.set('access-control-expose-headers', 'x-error, x-error-code');
    }
    return res;
  };
}

export const main = wrap(run)
  .with(catchAll)
  .with(adminContext)
  .with(addCommonResponseHeadersWrapper)
  .with(contentEncodeWrapper)
  .with(bodyData)
  .with(secrets)
  .with(helixStatus);
