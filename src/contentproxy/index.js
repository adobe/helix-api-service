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
import { fileTypeFromBuffer } from 'file-type';
import { MEDIA_TYPES, ValidationError } from '../media/validate.js';
import { applyCustomHeaders, errorResponse, logStack } from '../support/utils.js';
import { error } from './errors.js';
import google from './google.js';
import markup from './markup.js';
import onedrive from './onedrive.js';

/**
 * @type {import('./contentproxy').ContentSourceHandler[]}
 */
export const HANDLERS = { // exported for testing only
  google,
  onedrive,
  markup,
};

/**
 * Returns the content source handler for the given mountpoint
 *
 * @param {object} source
 * @return {import('./contentproxy').ContentSourceHandler} handler
 */
export function getContentSourceHandler(source) {
  return HANDLERS[source.type];
}

/**
 * Loads the content from the source provider.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} [opts] options
 * @param {object} [opts.source] content source
 * @param {string} [opts.lastModified] last modified
 * @param {number} [opts.fetchTimeout] fetch timeout
 *
 * @returns {Promise<Response>} the content response
 */
export async function contentProxy(context, info, opts) {
  const { config: { content: { source } }, log } = context;
  const { resourcePath, ext } = info;

  const handler = getContentSourceHandler(opts?.source ?? source);
  if (!handler) {
    return errorResponse(log, 404, error(
      'No handler found for document: $1',
      resourcePath,
    ));
  }

  try {
    if (ext === '.json') {
      return await handler.handleJSON(context, info, opts);
    }
    const mediaType = MEDIA_TYPES.find((type) => type.extensions.includes(ext));
    if (mediaType) {
      const response = await handler.handleFile(context, info, opts);
      if (response.status !== 200) {
        return response;
      }
      const { preprocess, validate } = mediaType;
      let buf = await response.buffer();
      if (preprocess) {
        buf = await preprocess(buf, log);
      }
      const { mime = 'application/octet-stream' } = await fileTypeFromBuffer(buf) || {};
      if (mime !== mediaType.mime) {
        return errorResponse(log, 409, error(
          'Unable to preview \'$1\': content is not a \'$2\' but: $3',
          resourcePath,
          mediaType.name,
          mime,
        ));
      }
      if (validate) {
        try {
          await validate(context, resourcePath, buf);
        } catch (e) {
          if (e instanceof ValidationError) {
            return errorResponse(log, 409, e);
            /* c8 ignore next 8 */
          } else {
            // generic error
            return errorResponse(log, 409, error(
              'Unable to preview \'$1\': validation failed: $2',
              resourcePath,
              e.message,
            ));
          }
        }
      }
      await applyCustomHeaders(context, info, response);
      return new Response(buf, response);
    }
    if (!ext || ext === '.md') {
      return await handler.handle(context, info, opts);
    }
    return errorResponse(log, 415, error(
      'Unable to preview \'$1\': \'$2\' backend does not support file type.',
      resourcePath,
      handler.name,
    ));
  } catch (e) {
    logStack(e);
    if (e.statusCode) {
      const headers = {};
      if (e.rateLimit?.retryAfter) {
        headers['retry-after'] = e.rateLimit.retryAfter;
        headers['x-severity'] = 'warn';
      } else if (e.statusCode === 429) {
        headers['x-severity'] = 'warn';
      }
      return errorResponse(log, -e.statusCode, error(
        'Unable to fetch \'$1\' from \'$2\': $3',
        resourcePath,
        handler.name,
        `(${e.statusCode}) - ${e.message}`,
      ), { headers });
    }
    return errorResponse(log, 500, error(
      'Unable to fetch \'$1\' from \'$2\': $3',
      resourcePath,
      handler.name,
      e.message,
    ));
  }
}
