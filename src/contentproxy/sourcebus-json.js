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
import { errorResponse } from '../support/utils.js';
import { assertValidSheetJSON } from './utils.js';
import { validateSource } from './sourcebus-utils.js';
import { error } from './errors.js';

function parseSheetJSON(data) {
  let json;
  try {
    json = JSON.parse(data);
  } catch {
    throw Error('invalid sheet json; failed to parse');
  }

  assertValidSheetJSON(json);
  return json;
}

/**
 * Fetches a JSON as sheet/multisheet from the external source.
 *
 * Falls back to code-bus if the content source does not have the resource.
 *
 * @param {import('../support/AdminContext').AdminContext} ctx context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} [opts] options
 * @param {object} [opts.source] content source
 * @param {string} [opts.lastModified] last modified
 * @param {number} [opts.fetchTimeout] fetch timeout
 * @returns {Promise<Response>} response
 */
export async function handleJSON(ctx, info, opts) {
  const { log } = ctx;
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

  let json;
  try {
    json = parseSheetJSON(body);
  } catch (e) {
    return errorResponse(log, 400, error(
      'JSON fetched from markup \'$1\' is invalid: $2',
      sourcePath,
      e.message,
    ));
  }

  return new Response(JSON.stringify(json), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'last-modified': meta.LastModified?.toUTCString(),
    },
  });
}
