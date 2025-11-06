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
import { AbortError, FetchError, Response } from '@adobe/fetch';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { contentProxy } from '../contentproxy/index.js';
import redirectMedia from '../media/redirect.js';
import { createErrorResponse } from './utils.js';

/**
 * S3 key max length
 */
const MAX_KEY_LENGTH = 1024;

/**
 * Fetches content from all sources configured.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
async function loadContent(context, info) {
  const { config } = context;
  const { content: { source: base, overlay } } = config;

  const sources = [base];
  if (overlay) {
    sources.unshift(overlay);
  }

  let res;

  for (const source of sources) {
    // eslint-disable-next-line no-await-in-loop
    res = await contentProxy(context, info, source);
    if (res.ok) {
      // succeeded
      return res;
    }
    if (res.status !== 404 && res.status !== 403) {
      // only check base source if not found.
      return res;
    }
  }
  return res;
}

/**
 * Updates a content resource by fetching the content from content-proxy and storing it in the
 * content-bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function update(context, info) {
  const { config: { content: { source } }, contentBusId, log } = context;
  const { resourcePath } = info;

  try {
    const storage = HelixStorage.fromContext(context).contentBus();
    const key = `${contentBusId}/preview${resourcePath}`;

    if (key.length >= MAX_KEY_LENGTH) {
      const limit = MAX_KEY_LENGTH - `${contentBusId}/preview`.length;
      return createErrorResponse({
        log,
        status: 400,
        msg: `resource path exceeds ${limit} characters`,
      });
    }

    let res = await loadContent(context, info);
    if (!res.ok) {
      return res;
    }

    res = await redirectMedia(context, info, res);
    if (!res.ok) {
      return res;
    }

    // preserve redirect location if already set on the content
    if (!res.headers.has('redirect-location') && !resourcePath.toLowerCase().endsWith('.pdf')) {
      const metadata = await storage.metadata(key);
      const redirectLocation = metadata?.['redirect-location'];
      if (redirectLocation) {
        res.headers.set('redirect-location', redirectLocation);
      }
    }
    res.headers.set('x-last-modified-by', context.attributes?.authInfo?.resolveEmail() || 'anonymous');
    if (!res.headers.has('last-modified')) {
      res.headers.set('last-modified', new Date().toUTCString());
    }

    await storage.store(key, res);
    await context.ensureInfoMarker(info, storage, source.url);

    return new Response('', { status: 200 });
  } catch (e) {
    /* c8 ignore next 5 */
    if (e instanceof AbortError) {
      return new Response(e.message, {
        status: 504,
      });
    }
    /* c8 ignore next 8 */
    if (e instanceof FetchError) {
      if (e.code === 'ECONNRESET') {
        // connection reset by host: temporary network issue
        return new Response(e.message, {
          status: 504,
        });
      }
    }
    const opts = { e, log };
    if (e?.$metadata?.httpStatusCode) {
      opts.status = e.$metadata.httpStatusCode;
    }
    return createErrorResponse(opts);
  }
}
