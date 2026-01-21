/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { headSource } from './get.js';

/**
 * Check if the request has any conditional headers such as If-Match and If-None-Match.
 * If the these headers are present, validate the condition.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response|null>} null if the condition is met, otherwise an error response
 */
export async function checkConditionals(context, info) {
  const ifMatch = info.headers['if-match'];
  // If both ifMatch and ifNoneMatch are present, prioritize ifMatch as per RFC 7232
  const ifNoneMatch = ifMatch ? null : info.headers['if-none-match'];
  const conditional = ifMatch || ifNoneMatch;

  if (conditional) {
    const head = await headSource(context, info);
    const etag = head.headers.get('etag');

    const resourceExists = head.status !== 404;
    const isMatchStar = conditional === '*';
    const isEtagMatch = conditional === etag;

    // Check the condition for the If-Match case
    const condFailed = isMatchStar ? !resourceExists : !isEtagMatch;

    // If the case is If-None-Match, negate the result of condFailed
    if ((ifMatch && condFailed) || (ifNoneMatch && !condFailed)) {
      return new Response('', { status: 412 });
    }
  }

  return null;
}
