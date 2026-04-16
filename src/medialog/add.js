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
import { errorResponse } from '../support/utils.js';
import { MediaLogBatch } from '../support/medialog.js';

/**
 * Adds entries to a media log.
 *
 * @param {import('../support/AdminContext.js').AdminContext} context context
 * @param {import('../support/RequestInfo.js').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function add(context) {
  const { authInfo, contentBusId, log } = context;
  const { data: { entries } } = context;

  if (!entries || !Array.isArray(entries)) {
    return errorResponse(log, 400, 'Adding media logs requires an array in \'entries\'');
  }
  if (entries.length > 10) {
    return errorResponse(log, 400, 'Array in \'entries\' should not contain more than 10 messages');
  }

  if (!contentBusId) {
    return errorResponse(log, 400, 'Unable to resolve contentBusId for this site');
  }

  const user = authInfo.resolveEmail();
  const batch = new MediaLogBatch(contentBusId);

  entries.forEach((entry) => {
    const notification = {
      ...entry,
      timestamp: Date.now(),
    };
    if (user && !notification.user) {
      notification.user = user;
    }
    batch.addNotification(notification);
  });
  await batch.send(context);

  return new Response('', {
    status: 201,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}
