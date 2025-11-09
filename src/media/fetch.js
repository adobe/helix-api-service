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
import { timeoutSignal } from '@adobe/fetch';

/**
 * Fetch timeout for media files.
 */
const FETCH_TIMEOUT = 10_000;

/**
 * Fetch media from a URL.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} url where to fetch media from
 * @return {Promise<object>} contains `error` if something failed,
 *         otherwise `buffer` and `contentType`
 */
export async function fetchMedia(context, url) {
  const { log } = context;

  const fetch = context.getFetch();
  const opts = {
    method: 'GET',
    headers: {
      'accept-encoding': 'identity',
      accept: 'image/jpeg,image/jpg,image/png,image/gif,video/mp4,application/xml,image/x-icon,image/avif,image/webp,*/*;q=0.8',
    },
    cache: 'no-store',
    signal: timeoutSignal(FETCH_TIMEOUT),
  };

  try {
    const response = await fetch(url, opts);
    const buffer = await response.buffer();

    log.debug(`Fetched media at: ${url}`, {
      statusCode: response.status,
      headers: response.headers.plain(),
    });
    if (!response.ok) {
      return { error: `Failed to fetch media at: ${url}: ${response.status}` };
    }
    return { buffer, contentType: response.headers.get('content-type') };
  } catch (e) {
    return { error: `Failed to fetch media at: ${url}: ${e.message}` };
    /* c8 ignore next 3 */
  } finally {
    opts.signal.clear();
  }
}
