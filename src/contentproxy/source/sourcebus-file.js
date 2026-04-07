/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { HelixStorage } from '@adobe/helix-shared-storage';
import { validateSource } from './sourcebus-utils.js';

/**
 * Fetches file data from the source bus
 *
 * @param {import('../support/AdminContext').AdminContext} ctx context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} [opts] options
 * @param {object} [opts.source] content source
 * @param {string} [opts.lastModified] last modified
 * @param {number} [opts.fetchTimeout] fetch timeout
 * @returns {Promise<Response>} response
 */
export async function handleFile(ctx, info, opts) {
  const {
    org, site, sourcePath, error: errorResp,
  } = await validateSource(ctx, info, opts);
  if (errorResp) {
    return errorResp;
  }

  // load content from source bus
  const sourceBus = HelixStorage.fromContext(ctx).sourceBus();
  const meta = {};
  const body = await sourceBus.get(`${org}/${site}${sourcePath}`, meta);
  if (!body) {
    return new Response('', { status: 404 });
  }

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': meta.ContentType,
      'last-modified': meta.LastModified?.toUTCString(),
    },
  });
}
