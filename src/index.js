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
import { helixStatus } from '@adobe/helix-status';

import login from './login/handler.js';
import status from './status/handler.js';
import Router from './router/router.js';
import { AdminContext } from './support/AdminContext.js';

const notImplemented = () => new Response('', { status: 405 });

function run(request, context) {
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

  return router.handle(request, context);
}

export default function adminContext(func) {
  return async (request, context) => func(request, new AdminContext(context));
}

export const main = wrap(run)
  .with(adminContext)
  .with(timing)
  .with(bodyData)
  .with(secrets)
  .with(helixStatus);
