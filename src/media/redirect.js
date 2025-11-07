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
import { storeBlob } from './store.js';
import { MEDIA_TYPES } from './validate.js';

/**
 * Runs after the content proxy response is fetched but before it is stored to S3.
 * Based on the extension, stores the media in the media bus and returns a redirect
 * that will be stored in the content bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {Response} response response
 * @returns {Promise<Response>} response
 */
export default async function redirectMedia(context, info, response) {
  const { ext, webPath } = info;

  if (!MEDIA_TYPES.find((type) => type.extensions.includes(ext))?.redirect) {
    // should not redirect
    return response;
  }

  const buf = await response.buffer();
  const blob = await storeBlob(context, info, buf, response.headers.get('content-type'));

  const { uri } = blob;
  const { pathname } = new URL(uri);
  const location = `${webPath.split('/').slice(0, -1).join('/')}${pathname}`;

  return new Response(pathname, {
    status: 200,
    headers: {
      'redirect-location': location,
    },
  });
}
