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
import { GoogleClient } from '@adobe/helix-google-support';
import { resolveResource } from '../support/google.js';
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';
import { FILE_SIZE_LIMIT } from './utils.js';

/**
 * Fetches a google file from the external source.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} a http response
 */
export async function handleFile(context, info) {
  const { config: { content: { contentBusId, source } }, log } = context;
  const { resourcePath } = info;

  try {
    const { id, mimeType, size: sizeS } = await resolveResource(context, info, {
      contentBusId, source,
    });
    if (!id) {
      return errorResponse(log, 404, error(
        'Unable to preview \'$1\': File not found',
        resourcePath,
      ));
    }
    const size = Number.parseInt(sizeS, 10);
    if (size > FILE_SIZE_LIMIT) {
      return errorResponse(log, 409, error(
        'Files larger than 500mb are not supported: $1',
        resourcePath,
      ));
    }
    const client = await context.getGoogleClient(contentBusId);
    const file = await client.getFile(id);
    return new Response(file, {
      status: 200,
      headers: {
        'content-type': mimeType,
        'x-source-location': GoogleClient.id2Url(id),
      },
    });
  } catch (e) {
    return errorResponse(context.log, 502, error(
      'Unable to fetch \'$1\' from \'$2\': $3',
      resourcePath,
      'google',
      `${e.message} (${e.code})`,
    ));
  }
}
