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
import { resolveResource } from '../support/onedrive.js';
import Tabular from './Tabular.js';
import extract from './sheets.js';

class Excel extends Tabular {
  /**
   * Create a new instance of this class
   * @param {OneDrive} drive one drive
   * @param {import('@adobe/helix-onedrive-support').DriveItem} item drive item
   */
  constructor(drive, item) {
    super('onedrive');

    this.drive = drive;
    this.item = item;
  }

  /**
   * @returns {Promise<import('@adobe/helix-onedrive-support').Workbook>}
   * @private
   */
  async _getWorkbook() {
    const { drive, item, log } = this;
    if (!this.workbook) {
      this.workbook = drive.getWorkbook(item);
      if (this.workbookSessionId) {
        this.workbook.setSessionId(this.workbookSessionId);
      }
      try {
        await this.workbook.application().calculate('FullRebuild');
      } catch (e) {
        log.warn(`Unable to recalculate workbook: ${e.message}`);
        if (e.statusCode === 429) {
          // if recalculating is already throttling, stop here
          throw e;
        }
      }
    }
    return this.workbook;
  }

  /**
   * Returns the last modified time
   * @returns {Promise<string>}
   */
  async getLastModified() {
    /* c8 ignore next 3 */
    if (!this.lastModified) {
      this.lastModified = this.item.lastModifiedDateTime;
    }
    return this.lastModified;
  }

  /**
   * Returns the sheet names.
   * @returns {Promise<string[]>}
   */
  async getSheetNames() {
    return (await this._getWorkbook()).getWorksheetNames();
  }

  /**
   * Returns the rows for the given sheet
   * @param {string} sheetName Sheet name
   * @returns {Promise<Array<Object>>}
   */
  async getRows(sheetName) {
    const worksheet = (await this._getWorkbook()).worksheet(encodeURIComponent(sheetName));
    return worksheet.usedRange().getValues();
  }

  withWorkbookSessionId(id) {
    this.workbookSessionId = id;
    return this;
  }
}

/**
 * Fetches an excel sheet from the external source.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
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
  const tabular = new Excel(client, OneDrive.driveItemFromURL(location), log)
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
