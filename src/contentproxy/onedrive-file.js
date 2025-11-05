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
import { OneDrive } from '@adobe/helix-onedrive-support';
import { resolveResource } from '../support/onedrive.js';
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';
import { addLastModified, FILE_SIZE_LIMIT } from './utils.js';

/**
 * Fetches file data from the external source.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function handleFile(context, info) {
  const { config: { content: { contentBusId, source } }, log } = context;
  const { org, site, resourcePath } = info;

  const {
    location,
    contentType,
    lastModified,
    size,
  } = await resolveResource(context, info, { source });

  if (size > FILE_SIZE_LIMIT) {
    return errorResponse(log, 409, error(
      'Files larger than 500mb are not supported: $1',
      resourcePath,
    ));
  }

  const client = await context.getOneDriveClient(org, site, {
    contentBusId,
    tenant: source.tenantId,
    logFields: {
      project: `${org}/${site}`,
      operation: `${info.route} ${resourcePath}`,
    },
  });
  const body = await client.downloadDriveItem(OneDrive.driveItemFromURL(location));
  return new Response(body, {
    status: 200,
    headers: addLastModified({
      'content-type': contentType,
      'x-source-location': location,
    }, lastModified),
  });
}
