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
import { google, GoogleClient } from '@adobe/helix-google-support';
import { resolveResource } from '../../support/google.js';
import { errorResponse } from '../../support/utils.js';
import { error } from '../errors.js';
import extract from '../sheets.js';
import { GoogleSheet } from './GoogleSheet.js';

/**
 * Fetches a google sheet from the external source.
 *
 * @param {import('../../support/AdminContext').AdminContext} context context
 * @param {import('../../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function handleJSON(context, info) {
  const { config: { content: { contentBusId, source } }, log } = context;
  const { resourcePath } = info;

  try {
    const { id } = await resolveResource(context, info, {
      contentBusId, source, type: GoogleClient.TYPE_SPREADSHEET,
    });
    if (!id) {
      return errorResponse(log, 404, error(
        'Unable to preview \'$1\': File not found',
        resourcePath,
      ));
    }
    const client = await context.getGoogleClient(contentBusId);
    const sheetsClient = google.sheets({ version: 'v4', auth: client.auth });
    const tabular = new GoogleSheet(sheetsClient, id, context.attributes.googleApiOpts)
      .withLog(log)
      .withResource(resourcePath);

    return extract(tabular, {
      'x-source-location': GoogleClient.id2Url(id),
    }, log);
  } catch (e) {
    return errorResponse(context.log, 502, error(
      'Unable to fetch \'$1\' from \'$2\': $3',
      resourcePath,
      'google',
      `${e.message} (${e.code})`,
    ));
  }
}
