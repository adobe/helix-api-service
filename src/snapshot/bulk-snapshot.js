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

import { AccessDeniedError } from '../auth/AccessDeniedError.js';
import { createErrorResponse } from '../contentbus/utils.js';
import { Job } from '../job/Job.js';
import { errorResponse, isIllegalPath } from '../support/utils.js';
import { SnapshotJob } from './SnapshotJob.js';
import { resolveUniquePaths } from './util.js';

const SYNCHRONOUS_LIMIT = 200;

/**
 * Handles bulk snapshot.
 *
 * @param {import('../support/AdminContext').AdminContext} context the context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} snapshotId snapshot id
 * @returns {Promise<Response>} response
 */
export async function bulkSnapshot(context, info, snapshotId) {
  const { log, attributes: { authInfo } } = context;

  try {
    authInfo.assertPermissions('snapshot:write');

    let paths = context.data.paths ?? [];
    if (paths.length === 0) {
      return errorResponse(log, 400, 'bulk-snapshot payload is missing \'paths\'.');
    }
    if (!Array.isArray(paths)) {
      return errorResponse(log, 400, 'bulk-snapshot \'paths\' is not an array.');
    }
    for (const path of paths) {
      if (isIllegalPath(path, true)) {
        return errorResponse(log, 400, `bulk-snapshot path not valid: ${path}`);
      }
    }

    paths = resolveUniquePaths(paths);
    const hasWildcard = paths.some((p) => p.endsWith('/*'));
    const transient = paths.length <= SYNCHRONOUS_LIMIT && !hasWildcard;

    if (hasWildcard) {
      authInfo.assertPermissions('preview:list');
    }

    // create new snapshot job
    return await Job.create(context, info, 'snapshot', {
      jobClass: SnapshotJob,
      transient,
      data: {
        paths,
        snapshotId,
        forceUpdate: String(context.data.forceUpdate) === 'true', // ensure boolean
      },
      roles: ['author'],
    });
  } catch (e) {
    if (e instanceof AccessDeniedError) {
      throw e;
    }
    return createErrorResponse({ e, log });
  }
}
