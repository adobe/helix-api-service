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
import { AbortError, Response } from '@adobe/fetch';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { errorResponse } from '../support/utils.js';
import {
  getContentSourceHeaders, assertValidSheetJSON, computeSourceUrl,
  updateMarkupSourceInfo, addLastModified,
} from './utils.js';
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
 * Fetch timeout for markup source.
 */
const FETCH_TIMEOUT = 10_000;

/**
 * Fetches a JSON as sheet/multisheet from the external source.
 *
 * Falls back to code-bus if the content source does not have the resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function handleJSON(context, info) {
  const { config: { content: { source } }, log } = context;
  const { resourcePath } = info;

  const fetch = context.getFetch(context);
  const url = await computeSourceUrl(log, info, source);
  const fopts = context.getFetchOptions({ fetchTimeout: FETCH_TIMEOUT });
  const contentSourceHeaders = getContentSourceHeaders(context, info, source);
  fopts.headers = { ...fopts.headers, ...contentSourceHeaders };

  try {
    const response = await fetch(url, fopts);

    updateMarkupSourceInfo(info.sourceInfo, response);

    if (response.status === 304) {
      return new Response('Not modified', {
        status: 304,
        headers: addLastModified({
          'x-source-location': url,
        }, response.headers.get('last-modified')),
      });
    }
    log.info(`[markup] fetched json from markup origin: ${url} (${response.status})`);

    if (response.ok) {
      let json;
      try {
        json = parseSheetJSON(await response.text());
      } catch (e) {
        return errorResponse(log, 400, error(
          'JSON fetched from markup \'$1\' is invalid: $2',
          resourcePath,
          e.message,
        ));
      }

      return new Response(JSON.stringify(json), {
        status: 200,
        headers: addLastModified({
          'content-type': response.headers.get('content-type'),
          'x-source-location': url,
        }, response.headers.get('last-modified')),
      });
    }

    // if response is other than 403, 404, also abort
    if (response.status !== 403 && response.status !== 404) {
      return errorResponse(log, -response.status, error(
        'Unable to fetch \'$1\' from \'$2\': $3',
        resourcePath,
        'markup',
        `(${response.status})`,
      ), { headers: { 'x-severity': 'warn' } });
    }
  } catch (e) {
    const status = e instanceof AbortError ? 504 : /* c8 ignore next */ 502;
    const headers = {};
    let { message } = e;

    if (message.match(/^getaddrinfo ENOTFOUND/)) {
      message = 'mountpoint URL invalid';
      headers['x-severity'] = 'warn';
    }
    return errorResponse(context.log, status, error(
      'Unable to fetch \'$1\' from \'$2\': $3',
      resourcePath,
      'markup',
      message,
    ), { headers });
  /* c8 ignore next 5 */
  } finally {
    if (fopts.signal) {
      fopts.signal.clear();
    }
  }

  // fallback to code-bus

  const { owner, repo, ref } = info;
  const codeBusPath = `/${owner}/${repo}/${ref}${resourcePath}`;
  const storage = HelixStorage.fromContext(context).codeBus();
  const item = await storage.get(codeBusPath);

  log.info(`[markup] fetched json from code-bus ${codeBusPath} (${item ? 200 : 404})`);
  if (!item) {
    return new Response(null, { status: 404 });
  }

  let json;
  try {
    json = parseSheetJSON(item);
  } catch (e) {
    return errorResponse(log, 400, error(
      'JSON fetched from markup \'$1\' is invalid: $2',
      resourcePath,
      e.message,
    ));
  }

  return new Response(JSON.stringify(json), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
