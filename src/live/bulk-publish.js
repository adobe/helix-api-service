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
import { errorResponse, isIllegalPath } from '../support/utils.js';
import { error } from '../contentproxy/errors.js';
import { PublishJob } from './PublishJob.js';

/**
 * Maximum number of paths supported for a synchronous bulk-publish.
 */
const MAX_SYNC_PATHS = 200;

/**
 * Handles bulk publish of live resources.
 *
 * @param {import('../support/AdminContext').AdminContext} context the universal context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function bulkPublish(context, info) {
  const { log } = context;

  const paths = context.data.paths ?? [];
  if (paths.length === 0) {
    return errorResponse(log, 400, "bulk-publish payload is missing 'paths'.");
  }
  if (!Array.isArray(paths)) {
    return errorResponse(log, 400, "bulk-publish 'paths' is not an array.");
  }
  for (const path of paths) {
    if (isIllegalPath(path, true)) {
      return errorResponse(log, 400, `bulk-publish path not valid: ${path}`);
    }
    if (path.startsWith('/.helix/')) {
      return errorResponse(log, 400, `bulk-publish of config resources is not supported: ${path}`);
    }
  }
  // disallow tree publish — see https://github.com/adobe/helix-admin/issues/1969
  if (paths.some((path) => path.endsWith('/*'))) {
    return errorResponse(log, 400, 'bulk-publish does not support publishing of subtrees due to security reasons.');
  }

  if (paths.length > MAX_SYNC_PATHS && String(context.data.forceAsync) !== 'true') {
    return errorResponse(log, 400, error(
      'Bulk path limit exceeded for $1 content source ($2 > $3). Use forceAsync=true',
      'this',
      paths.length,
      MAX_SYNC_PATHS,
    ));
  }

  return Job.create(context, info, PublishJob.TOPIC, {
    transient: true,
    jobClass: PublishJob,
    data: {
      paths,
      forceUpdate: String(context.data.forceUpdate) === 'true',
    },
    roles: ['author'],
  });
}
