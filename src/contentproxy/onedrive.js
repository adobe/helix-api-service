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
import { handleJSON } from './onedrive-json.js';
import { handleFile } from './onedrive-file.js';
import { list } from './onedrive-list.js';
import { resolveResource } from '../support/onedrive.js';
import fetchContent from './fetch-content.js';
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';

/**
 * Retrieves a file from OneDrive.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} [opts] options
 * @param {string} [opts.lastModified] last modified
 * @param {number} [opts.fetchTimeout] fetch timeout
 * @returns {Promise<Response>} response
 */
async function handle(context, info, opts) {
  const { config: { content: { contentBusId, source } }, log } = context;
  const { org, site, resourcePath } = info;
  const {
    name,
    location: shareLink,
    lastModified,
    contentType,
    size,
  } = await resolveResource(context, info, { source });

  // only handle docx
  if (name.endsWith('.md')) {
    return errorResponse(context.log, 415, error(
      'File type not supported: $1',
      'markdown',
    ));
  }
  if (contentType && contentType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return errorResponse(log, 415, error(
      'File type not supported: $1',
      contentType,
    ));
  }
  if (size === 0) {
    return errorResponse(log, 404, error(
      'File is empty, no markdown version available: $1',
      resourcePath,
    ));
  }
  if (size > 100 * 1024 * 1024) {
    return errorResponse(log, 409, error(
      'Documents larger than 100mb not supported: $1',
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
  await client.auth.initTenantFromMountPoint(source);
  const { accessToken } = await client.auth.authenticate();
  const providerParams = {
    shareLink,
    resourcePath, // this pure informational for logging
  };
  if (context.attributes.config?.limits?.preview?.maxImageSize) {
    providerParams.maxImageSize = context.attributes.config.limits.preview.maxImageSize;
  }
  const resp = await fetchContent(context, info, {
    ...opts,
    provider: {
      package: 'helix3',
      name: 'word2md',
      version: context.data['hlx-word2md-version'],
      defaultVersion: 'v7',
      sourceLocationMapping: (id) => ((id ? `onedrive:${id}` : '')),
    },
    providerParams,
    providerHeaders: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (resp.ok && lastModified !== null) {
    resp.headers.set('last-modified', new Date(lastModified).toUTCString());
  }
  return resp;
}

/**
 * @type {import('./contentproxy.js').ContentSourceHandler}
 */
export default {
  name: 'onedrive',
  handle,
  handleJSON,
  handleFile,
  list,
};
