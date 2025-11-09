/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { Response } from '@adobe/fetch';
import { cleanupHeaderValue } from '@adobe/helix-shared-utils';
import { AccessDeniedError } from '../auth/AccessDeniedError.js';
import { StatusCodeError } from '../support/StatusCodeError.js';

/**
 * Catch all wrapper that will turn exceptions into responses.
 *
 * @param {function} func next function in chain
 * @returns {callback} callback to invoke
 */
export default function catchAll(func) {
  return async (request, context) => {
    try {
      const response = await func(request, context);
      return response;
    } catch (e) {
      const { log, attributes: { authInfo } } = context;
      /* c8 ignore start */
      if (e instanceof AccessDeniedError) {
        if (authInfo.authenticated) {
          log.warn(`request authenticated but needs permissions: ${e.message}`);
          return new Response('', {
            status: 403,
            headers: {
              'x-error': 'not authorized',
            },
          });
        }
        log.warn(`request not authenticated but needs permissions: ${e.message}`);
        return new Response('', {
          status: 401,
          headers: {
            'x-error': 'not authenticated',
          },
        });
      }
      if (e instanceof TypeError) {
        log.warn(e);
      }
      return new Response('', {
        status: e.status || e.statusCode || e.$metadata?.httpStatusCode || 500,
        headers: {
          'x-error': cleanupHeaderValue(e instanceof StatusCodeError ? e.message : e.toString()),
        },
      });
      /* c8 ignore end */
    }
  };
}
