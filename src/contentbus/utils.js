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

'use strict';

import { Response } from '@adobe/fetch';
import { cleanupHeaderValue, logLevelForStatusCode } from '@adobe/helix-shared-utils';

/**
 * Create an error response.
 * @return {Response} a universal response
 */
export function createErrorResponse(opts) {
  const { e, msg, log } = opts;

  const status = e?.status || e?.statusCode || opts.status || 500;
  const message = e?.message || msg;
  const args = [message];
  if (e) {
    args.push(e);
  }
  const level = logLevelForStatusCode(status);
  log[level](...args);

  return new Response('', {
    status,
    headers: {
      'x-error': cleanupHeaderValue(message),
    },
  });
}
