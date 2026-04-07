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
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../auth/AuthInfo.js';

/**
 * Wrapper to turn an SQS record into a http request
 * @param {UniversalAction} fn
 * @returns {function(Request, UniversalContext): Promise<Response>}
 */
export function sqsEventAdapter(fn) {
  return async (req, ctx) => {
    ctx.attributes = ctx.attributes ?? {};
    const { records = [] } = ctx;
    if (records.length > 0) {
      if (records.length !== 1) {
        ctx.log.warn(`Received ${records.length} messages, only the first will be processed.`);
      }
      const [record] = records;
      ctx.attributes.messageId = record.messageId.substring(0, 8);

      const { messageId: ID } = ctx.attributes;
      ctx.log.info(`[${ID}] Received message`);
      const {
        method, headers, path, body, roles,
      } = JSON.parse(record.body);
      if (method && headers && path) {
        ctx.attributes.authInfo = await AuthInfo.Default()
          .withAuthenticated(true)
          .withRoles(roles);
        return fn(
          new Request(req, { method, headers, body }),
          { ...ctx, pathInfo: { suffix: path } },
        );
      }
    }
    return fn(req, ctx);
  };
}
