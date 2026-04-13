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
import { Job } from '../job/Job.js';
import { errorResponse, isIllegalPath, processPrefixedPaths } from '../support/utils.js';
import { RemoveJob } from './RemoveJob.js';
import { error } from '../contentproxy/errors.js';

/**
 * Maximum number of paths supported for a synchronous bulk-remove.
 */
const MAX_SYNC_PATHS = 200;

/**
 * Handles recursive bulk remove.
 *
 * @param {import('../support/AdminContext').AdminContext} context the universal context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function bulkRemove(context, info) {
  const { log } = context;

  const paths = context.data.paths ?? [];
  if (paths.length === 0) {
    return errorResponse(log, 400, "bulk-remove payload is missing 'paths'.");
  }
  if (!Array.isArray(paths)) {
    return errorResponse(log, 400, "bulk-remove 'paths' is not an array.");
  }
  for (const path of paths) {
    if (isIllegalPath(path, true)) {
      return errorResponse(log, 400, `bulk-remove path not valid: ${path}`);
    }
    if (path.startsWith('/.helix/')) {
      return errorResponse(log, 400, `bulk-remove of config resources is not supported: ${path}`);
    }
  }

  if (paths.length > MAX_SYNC_PATHS && String(context.data.forceAsync) !== 'true') {
    return errorResponse(log, 400, error(
      'Bulk path limit exceeded for $1 content source ($2 > $3). Use forceAsync=true',
      'this',
      paths.length,
      MAX_SYNC_PATHS,
    ));
  }

  return Job.create(context, info, RemoveJob.TOPIC, {
    transient: true,
    jobClass: RemoveJob,
    data: {
      paths: processPrefixedPaths(paths),
    },
    roles: ['author'],
  });
}
