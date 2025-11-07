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
import { Headers } from '@adobe/fetch';

/**
 * Fetch page. If an error occurs, returns a status and error.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {URL} url URL
 * @param {Headers} [headers] additional headers
 * @returns response body and headers or error
 */
export async function fetchPage(context, url, headers = {}) {
  const { log } = context;

  const fetch = context.getFetch();
  const filename = url.split('/').pop();
  const idx = filename.lastIndexOf('.');
  const isHTML = idx === -1;

  const options = isHTML
    ? { method: 'GET', redirect: 'manual' }
    : { method: 'HEAD' };

  log.info(`Reading ${isHTML ? 'HTML' : 'non-HTML'} from: ${url}`);

  let response;
  let body;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'index-pipelines/html_json',
        ...headers,
      },
      cache: 'no-store',
      ...options,
    });
    body = isHTML ? await response.text() : '';
  } catch (e) {
    response = {
      ok: false,
      status: 502,
    };
    body = e.message;
  }
  if (!response.ok) {
    if (response.status === 404 || response.status === 301) {
      return {
        status: response.status,
      };
    }
    // check 302 redirect (todo: fix browser detection in *.live)
    if (response.status === 302 && !(response.headers.get('location') ?? '').startsWith('/')) {
      // assume login to redirect
      log.warn(`Detected login redirect for ${url}. assume statusCode: 401`);
      return {
        status: 401,
        error: `Unauthorized to fetch ${url}`,
      };
    }
    const snippet = body.length < 100 ? body : `${body.substr(0, 100)}...`;
    log.warn(`Fetching ${url} failed: statusCode: ${response.status}, body: '${snippet}'`);
    return {
      status: response.status,
      error: `Fetching ${url} failed`,
    };
  }
  if (isHTML) {
    const s = body.trim();
    if (s.substring(s.length - 7).toLowerCase() !== '</html>') {
      const error = `Document returned from ${url} seems incomplete (html end tag not found)`;
      log.warn(error);
      return {
        status: 500,
        error,
      };
    }
  }
  return { body, headers: new Headers(response.headers) };
}
