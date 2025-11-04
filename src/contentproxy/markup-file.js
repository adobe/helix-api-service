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
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';
import {
  addLastModified, computeSourceUrl, getContentSourceHeaders, updateMarkupSourceInfo,
} from './utils.js';

/**
 * Fetch timeout for markup files.
 */
const FETCH_TIMEOUT = 5_000;

/**
 * Fetches file data from the external source.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} opts options
 * @param {string} opts.lastModified last modified
 * @param {number} opts.fetchTimeout fetch timeout
 * @returns {Promise<Response>} response
 */
export async function handleFile(context, info, opts) {
  const { config: { content: { source } }, log } = context;
  const { org, site, resourcePath } = info;
  const fetch = context.getFetch();

  const url = await computeSourceUrl(log, info, source);
  const fopts = context.getFetchOptions({ fetchTimeout: FETCH_TIMEOUT, ...opts });
  const contentSourceHeaders = getContentSourceHeaders(context, info);
  fopts.headers = { ...fopts.headers, ...contentSourceHeaders };

  try {
    const response = await fetch(url, fopts);

    updateMarkupSourceInfo(info.sourceInfo, response);

    if (response.status === 404) {
      return errorResponse(context.log, 404, error(
        'Unable to preview \'$1\': File not found',
        `${org}/${site}${resourcePath}`,
      ));
    }

    const lastModified = response.headers.get('last-modified');
    if (response.status === 304) {
      return new Response('Not modified', {
        status: 304,
        headers: addLastModified({
          'x-source-location': url,
        }, lastModified),
      });
    }

    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (!contentType) {
        return errorResponse(context.log, 415, error(
          'Content type header is missing',
        ));
      }
      const body = await response.buffer();

      return new Response(body, {
        status: 200,
        headers: addLastModified({
          'content-type': contentType,
          'x-source-location': url,
        }, lastModified),
      });
    } else {
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
    return errorResponse(log, status, error(
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
}
