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
import { AuditLog } from '@adobe/helix-admin-support';
import { errorResponse } from '../support/utils.js';
import {
  decode, encode, getNextLinkUrl, parseIntWithCond, parseTimespan,
} from './utils.js';

/**
 * Total size of collected entries in log, when stringified.
 */
export const MAX_ENTRIES_SIZE = 3_000_000;

/**
 * Query an audit log
 *
 * @param {import('./AdminContext.js').AdminContext} context context
 * @param {import('./RequestInfo.js').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function query(context, info) {
  const {
    log, data: {
      from: fromS, to: toS, since: sinceS, limit: limitS, nextToken,
    },
  } = context;

  let from;
  let to;

  try {
    ([from, to] = parseTimespan(fromS, toS, sinceS));
  } catch (e) {
    return errorResponse(log, 400, e.message);
  }

  const limit = parseIntWithCond(limitS, (value) => {
    if (value >= 1 && value <= 1000) {
      return true;
    }
    log.warn(`'limit' should be between 1 and 1000: ' ${value}`);
    return false;
  }, 1000);

  const { org, site } = info;
  const auditLog = AuditLog.createReader(org, site, log);

  try {
    await auditLog.init();

    const { entries, next } = await auditLog.getEntries(
      from,
      to,
      { limit, maxSize: MAX_ENTRIES_SIZE },
      decode(nextToken),
    );
    const result = {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      entries,
    };
    if (next) {
      result.nextToken = encode(next);
      result.links = {
        next: getNextLinkUrl({
          from: result.from,
          to: result.to,
          limit: limitS,
          nextToken: result.nextToken,
        }, info),
      };
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  } finally {
    auditLog.close();
  }
}
