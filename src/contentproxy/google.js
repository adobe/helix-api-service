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
import { GoogleClient } from '@adobe/helix-google-support';
import { resolveResource } from '../support/google.js';
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';
import fetchContent from './fetch-content.js';
import { handleFile } from './google-file.js';
import { handleJSON } from './google-json.js';
import { list } from './google-list.js';

/**
 * Retrieves a file from google drive.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} opts options
 * @param {string} opts.lastModified last modified
 * @param {number} opts.fetchTimeout fetch timeout
 * @returns {Promise<Response>} response
 */
async function handle(context, info, opts) {
  const { config: { content: { contentBusId, source } } } = context;
  const { org, site, resourcePath } = info;

  const { id, mimeType } = await resolveResource(context, info, {
    contentBusId, source, type: GoogleClient.TYPE_DOCUMENT,
  });
  if (!id) {
    return errorResponse(context.log, 404, error(
      'Unable to preview \'$1\': File not found',
      `${org}/${site}${resourcePath}`,
    ));
  }
  // only handle docx
  if (mimeType && mimeType !== 'application/vnd.google-apps.document') {
    return errorResponse(context.log, 415, error(
      'Unable to preview \'$1\': File type not supported: $2',
      resourcePath,
      mimeType,
    ));
  }
  const client = await context.getGoogleClient(contentBusId);
  const { token } = await client.auth.getAccessToken();

  return fetchContent(context, info, {
    ...opts,
    provider: {
      package: 'helix3',
      name: 'gdocs2md',
      version: context.data['hlx-gdocs2md-version'],
      defaultVersion: 'v7',
      sourceLocationMapping: GoogleClient.id2Url,
    },
    providerParams: {
      rootId: id,
    },
    providerHeaders: {
      authorization: `Bearer ${token}`,
    },
  });
}

function test(source) {
  return source?.type === 'google';
}

/**
 * @type {import('./contentproxy.js').ContentSourceHandler}
 */
export default {
  name: 'google',
  test,
  handle,
  handleJSON,
  handleFile,
  list,
};
