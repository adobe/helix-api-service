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
import purge, { PURGE_PREVIEW_AND_LIVE } from '../cache/purge.js';
import { rebuildSitemap } from './update.js';

/**
 * Allowed methods for that handler.
 */
const ALLOWED_METHODS = ['POST'];

/**
 * Handles the sitemap route
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function sitemapHandler(context, info) {
  if (ALLOWED_METHODS.indexOf(info.method) < 0) {
    return new Response('method not allowed', {
      status: 405,
    });
  }

  const res = await rebuildSitemap(context, info, { updatePreview: true });
  if (res.status === 200) {
    const result = await res.json();
    await purge.content(context, info, result.paths, PURGE_PREVIEW_AND_LIVE);
    return new Response(result, { status: 200 });
  }
  return res;
}
