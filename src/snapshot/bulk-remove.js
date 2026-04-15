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
import { error } from '../contentproxy/errors.js';
import { Job } from '../job/Job.js';
import { errorResponse, isIllegalPath, processPrefixedPaths } from '../support/utils.js';
import { SnapshotRemoveJob } from './SnapshotRemoveJob.js';

const MAX_SYNC_PATHS = 200;

/**
 * Handles bulk snapshot remove.
 *
 * @param {import('../support/AdminContext').AdminContext} context the context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function bulkRemove(context, info) {
  const { log, attributes: { authInfo } } = context;

  try {
    authInfo.assertPermissions('snapshot:delete');

    const paths = context.data.paths ?? [];
    if (paths.length === 0) {
      return errorResponse(log, 400, 'bulk-snapshot-remove payload is missing \'paths\'.');
    }
    if (!Array.isArray(paths)) {
      return errorResponse(log, 400, 'bulk-snapshot-remove \'paths\' is not an array.');
    }
    for (const path of paths) {
      if (isIllegalPath(path, true)) {
        return errorResponse(log, 400, `bulk-snapshot-remove path not valid: ${path}`);
      }
    }

    const processedPaths = processPrefixedPaths(paths);

    if (processedPaths.length > MAX_SYNC_PATHS && String(context.data.forceAsync) !== 'true') {
      return errorResponse(log, 400, error(
        'Bulk path limit exceeded for $1 content source ($2 > $3). Use forceAsync=true',
        'this',
        processedPaths.length,
        MAX_SYNC_PATHS,
      ));
    }

    return await Job.create(context, info, SnapshotRemoveJob.TOPIC, {
      jobClass: SnapshotRemoveJob,
      transient: true,
      data: {
        snapshotId: info.snapshotId,
        paths: processedPaths,
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
