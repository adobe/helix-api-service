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
import { createErrorResponse } from '../contentbus/utils.js';
import { Job } from '../job/job.js';
import { errorResponse, isIllegalPath, processPrefixedPaths } from '../support/utils.js';
import { IndexJob } from './IndexJob.js';

/**
 * Handles bulk indexing.
 *
 * @param {import('../support/AdminContext').AdminContext} context the universal context
 * @param {import('../support/RequestInfo').RequestInfo} info path info
 *
 * @returns {Promise<Response>} response
 */
export default async function bulkIndex(context, info) {
  const { log, data: { paths = [], indexNames = [] } } = context;

  try {
    if (paths.length === 0) {
      return errorResponse(log, 400, 'bulk-index payload is missing \'paths\'');
    }
    if (!Array.isArray(paths)) {
      return errorResponse(log, 400, 'bulk-index \'paths\' is not an array');
    }
    if (!Array.isArray(indexNames)) {
      return errorResponse(log, 400, 'bulk-index \'indexNames\' is not an array');
    }
    for (const path of paths) {
      if (isIllegalPath(path, true)) {
        return errorResponse(log, 400, `bulk-index path not valid: ${path}`);
      }
      if (path.startsWith('/.helix/')) {
        return errorResponse(log, 400, `bulk-index of config resources is not supported: ${path}`);
      }
    }
    return await Job.create(context, info, 'index', {
      transient: true,
      jobClass: IndexJob,
      data: {
        paths: processPrefixedPaths(paths),
        indexNames,
      },
      roles: ['author'],
    });
  } catch (e) {
    return createErrorResponse({ e, log });
  }
}
