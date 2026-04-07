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
import { getContentSourceHandler } from '../contentproxy/index.js';
import { errorResponse, isIllegalPath } from '../support/utils.js';
import { Job } from '../job/Job.js';
import { PreviewJob } from './PreviewJob.js';
import { error } from '../contentproxy/errors.js';

/**
 * Maximum number of paths that can be supported with a synchronous bulk-preview
 */
const MAX_SYNC_PATHS = {
  google: 30,
  onedrive: 15,
  markup: 30,
  sourcebus: 150,
};

/**
 * Handles recursive bulk preview. Note that bulk preview only respects 'normal' content resources,
 * but does not preview configurations or special files, like /.helix/config or redirects.
 *
 * currently only the following is supported:
 * - onedrive (not google docs, not markup)
 * - documents (no excel)
 * - static files, like images, pdfs, etc.
 *
 * @param {import('../support/AdminContext').AdminContext} context the universal context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function bulkPreview(context, info) {
  const { log } = context;

  const paths = context.data.paths ?? [];
  if (paths.length === 0) {
    return errorResponse(log, 400, 'bulk-preview payload is missing "paths".');
  }
  if (!Array.isArray(paths)) {
    return errorResponse(log, 400, 'bulk-preview "paths" is not an array.');
  }

  for (const path of paths) {
    if (isIllegalPath(path, true)) {
      return errorResponse(log, 400, `bulk-preview path not valid: ${path}`);
    }
    if (path.startsWith('/.helix/')) {
      return errorResponse(log, 400, `bulk-preview of config resources is not supported: ${path}`);
    }
  }

  // check if handler supports bulk-preview
  const handler = getContentSourceHandler(context.config.content.source);
  if (!handler) {
    return errorResponse(log, 404, `No handler found for resource hlx:/${info.org}/${info.site}/${info.ref}${info.webPath}.`);
  }
  if (!handler.list) {
    return errorResponse(log, 400, `bulk-preview not supported for handler "${handler.name}".`);
  }

  const hasSubtreePath = paths.some((path) => String(path).endsWith('/*'));
  if (hasSubtreePath && handler.name === 'markup') {
    return errorResponse(log, 400, 'wildcard paths are not supported with a markup content source.');
  }

  if (hasSubtreePath || paths.length > 100) {
    // only assert list permissions when there's a deep path
    context.attributes.authInfo.assertPermissions('edit:list');
  }

  if (paths.length > MAX_SYNC_PATHS[handler.name] && String(context.data.forceAsync) !== 'true') {
    return errorResponse(log, 400, error(
      'Bulk path limit exceeded for $1 content source ($2 > $3). Use forceAsync=true',
      handler.name,
      paths.length,
      MAX_SYNC_PATHS[handler.name],
    ));
  }

  // create new preview job
  return Job.create(context, info, PreviewJob.TOPIC, {
    transient: true,
    jobClass: PreviewJob,
    data: {
      paths: paths.map((p) => String(p)), // ensure strings
      forceUpdate: String(context.data.forceUpdate) === 'true', // ensure boolean
    },
    roles: ['author'],
  });
}
