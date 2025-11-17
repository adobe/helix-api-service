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
import { Response } from '@adobe/fetch';

import cache from '../cache/handler.js';
import code from '../code/handler.js';
import contentproxy from '../contentproxy/handler.js';
import discover from '../discover/handler.js';
import index from '../index/handler.js';
import live from '../live/handler.js';
import log from '../log/handler.js';
import { auth, login, logout } from '../login/handler.js';
import media from '../media/handler.js';
import preview from '../preview/handler.js';
import profile from '../profile/handler.js';
import sitemap from '../sitemap/handler.js';
import status from '../status/handler.js';

import Router from './router.js';

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
export const table = new Router(nameSelector)
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
  .add('/:org/sites/:site/log', log)
  .add('/:org/sites/:site/login', login)
  .add('/:org/sites/:site/media/*', media)
  .add('/:org/sites/:site/code/:ref/*', code)
  .add('/:org/sites/:site/cache/*', cache)
  .add('/:org/sites/:site/index/*', index)
  .add('/:org/sites/:site/sitemap/*', sitemap)
  .add('/:org/sites/:site/snapshots/*', notImplemented)
  .add('/:org/sites/:site/source/*', notImplemented)
  .add('/:org/sites/:site/jobs', notImplemented);
