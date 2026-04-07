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
import { OneDrive } from '@adobe/helix-onedrive-support';
import { resolveResource } from '../../support/onedrive.js';
import extract from '../sheets.js';
import { OnedriveSheet } from './OneDriveSheet.js';

/**
 * Fetches an excel sheet from the external source.
 *
 * @param {import('../../support/AdminContext').AdminContext} context context
 * @param {import('../../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function handleJSON(context, info) {
  const { config: { content: { contentBusId, source } }, log } = context;
  const { org, site, resourcePath } = info;

  const {
    location,
    lastModified,
  } = await resolveResource(context, info, { source });

  const client = await context.getOneDriveClient(org, site, {
    contentBusId,
    tenant: source.tenantId,
    logFields: {
      project: `${org}/${site}`,
      operation: `${info.route} ${resourcePath}`,
    },
  });
  const workbookSessionId = info.headers['x-workbook-session-id'];
  const tabular = new OnedriveSheet(client, OneDrive.driveItemFromURL(location), log)
    .withLog(log)
    .withResource(resourcePath)
    .withWorkbookSessionId(workbookSessionId);

  const headers = {
    'x-source-location': location,
  };
  if (lastModified !== null) {
    tabular.lastModified = new Date(lastModified).toUTCString();
    headers['last-modified'] = tabular.lastModified;
  }
  return extract(tabular, headers, log);
}
