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
import A1 from '@flighter/a1-notation';
import { resolveResource } from '../support/google.js';
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';
import extract from './sheets.js';
import Tabular from './Tabular.js';
import { rewriteCellUrl } from './utils.js';

/**
 * Monospace fonts used in google docs
 */
const CODE_FONTS = {
  'Courier New': true,
  'Source Code Pro': true,
  VT323: true,
  Consolas: true,
  Courier: true,
  'Nanum Gothic Coding': true,
  Cousine: true,
};

/**
 * Checks if the font specified by fontFamily is a font used to format code.
 * @param {string} fontFamily
 * @returns {boolean} {@code true} if the font is a code font.
 */
function isCodeFont(fontFamily) {
  if (!fontFamily) {
    return false;
  }
  return (fontFamily in CODE_FONTS || fontFamily.match(/\sMono/));
}

/**
 * Sanitize HTMl by:
 * - replace line breaks with <br>
 * - make paragraphs, separated with empty lines
 *
 * @param {string} html
 * @returns {string} sanitized HTML
 */
export function sanitizeHtml(html) {
  // eslint-disable-next-line no-param-reassign
  html = html.trim();
  if (!html) {
    return '';
  }
  const lines = html.split('\n').map((l) => l.trim());
  const paras = [];
  const para = [];
  for (const line of lines) {
    if (line) {
      para.push(line);
    } else {
      paras.push(para.join('<br>'));
      para.length = 0;
    }
  }
  if (para.length) {
    paras.push(para.join('<br>'));
  }
  return paras.map((p) => `<p>${p}</p>`).join('');
}

/**
 * Extracts the row data value and formats it using html markup.
 * @see https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/cells#CellData
 * @param {CellData} cell
 */
function formatCell(cell) {
  const value = cell.userEnteredValue?.stringValue;
  if (!value) {
    return '';
  }
  const { textFormatRuns: runs = [] } = cell;

  // all formats of the text runs inherit from the base format
  const baseFormat = cell.userEnteredFormat?.textFormat ?? {};

  // Check for full cell format.
  if (!runs.length) {
    baseFormat.underline = !!baseFormat.link;
    runs.push({
      format: baseFormat,
    });
  }

  const HTML_FMT = {
    bold: 'strong',
    code: 'code',
    italic: 'em',
    strikethrough: 'del',
    underline: 'a',
  };
  const formats = {
    bold: false,
    code: false,
    italic: false,
    strikethrough: false,
    underline: false,
  };
  // sheets has a weird behaviour, such as only the text-run of the underline matches the actual
  // text in the value; the link startIndex might not match. so we only set the <a> for an underline
  let lastLinkUri = null;
  const parts = [];
  let idx = 0;
  for (const { startIndex = 0, format = {} } of runs) {
    const effective = {
      ...baseFormat,
      ...format,
    };

    if (idx !== startIndex) {
      parts.push(value.substring(idx, startIndex));
      idx = startIndex;
    }
    for (const [fmt, fv] of Object.entries(formats)) {
      let formatValue = effective[fmt];
      if (fmt === 'code') {
        formatValue = isCodeFont(effective?.fontFamily);
      }
      if (fmt === 'underline' && formatValue && fv && effective.link && lastLinkUri !== effective.link.uri) {
        // if consecutive link, close the previous one.
        lastLinkUri = effective.link.uri;
        parts.push(`</a><a href="${encodeURI(rewriteCellUrl(lastLinkUri))}">`);
      } else if (fv && !formatValue) {
        formats[fmt] = false;
        parts.push(`</${HTML_FMT[fmt]}>`);
        if (fmt === 'underline') {
          lastLinkUri = null;
        }
      } else if (!fv && formatValue) {
        formats[fmt] = true;
        if (fmt === 'underline') {
          lastLinkUri = effective.link.uri;
          parts.push(`<a href="${encodeURI(rewriteCellUrl(lastLinkUri))}">`);
        } else {
          parts.push(`<${HTML_FMT[fmt]}>`);
        }
      }
    }
  }
  if (idx < value.length - 1) {
    parts.push(value.substring(idx, value.length));
  }
  for (const [fmt, fv] of Object.entries(formats)) {
    if (fv) {
      parts.push(`</${HTML_FMT[fmt]}>`);
    }
  }

  return sanitizeHtml(parts.join(''));
}

class Google extends Tabular {
  constructor(sheetsClient, id, googleApiOpts) {
    super('google');
    this.sheets = sheetsClient;
    this.spreadsheetId = id;
    this.googleApiOpts = googleApiOpts;
  }

  /**
   * @returns {Promise<GoogleSheet>}
   * @private
   */
  async _getSheetData() {
    if (!this.data) {
      const { data } = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      }, this.googleApiOpts);
      this.data = data;
    }
    return this.data;
  }

  /**
   * Returns the sheet names.
   * @returns {Promise<string[]>}
   */
  async getSheetNames() {
    return (await this._getSheetData()).sheets.map((s) => s.properties.title);
  }

  /**
   * Returns the rows for the given sheet
   * @param {string} sheetName Sheet name
   * @returns {Promise<Array<Object>>}
   */
  async getRows(sheetName) {
    const data = await this._getSheetData();
    const sheet = data.sheets.find((s) => s.properties.title === sheetName);

    const range = `${sheet.properties.title}!${new A1({
      colStart: 1,
      rowStart: 1,
      nRows: sheet.properties.gridProperties.rowCount,
      nCols: sheet.properties.gridProperties.columnCount,
    })}`;

    const result = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }, this.googleApiOpts);

    const { values } = result.data;
    const RICHTEXT_SUFFIX = ' (formatted)';
    if (values?.length) {
      const richCols = [];
      const columns = values[0].map((name) => Tabular.superTrim(name));
      for (let idx = 0; idx < columns.length; idx += 1) {
        let name = columns[idx];
        if (name.endsWith(RICHTEXT_SUFFIX)) {
          name = name.substring(0, name.length - RICHTEXT_SUFFIX.length).trim();
          values[0][idx] = name;
          richCols.push(idx);
        }
      }
      if (richCols.length) {
        await this.loadRichTextValues(sheet, values, richCols);
      }
    }
    return values;
  }

  async loadRichTextValues(sheet, values, cols) {
    const ranges = cols.map((idx) => (`${sheet.properties.title}!${new A1({
      colStart: idx + 1,
      rowStart: 1, // skip the header row
      nRows: values.length, // only fetch as many rows as there are values
      nCols: 1,
    })}`));

    const { data } = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      ranges,
      fields: 'sheets.data.rowData.values(userEnteredValue,userEnteredFormat,textFormatRuns)',
    }, this.googleApiOpts);

    // since we requested several ranges, we get a GridData object for each range
    for (let rangeIdx = 0; rangeIdx < data.sheets[0].data.length; rangeIdx += 1) {
      const rows = data.sheets[0].data[rangeIdx].rowData;
      // start at row 1 (2nd row, to skip the column name)
      for (let rowIdx = 1; rowIdx < rows.length && rowIdx < values.length; rowIdx += 1) {
        // eslint-disable-next-line no-param-reassign
        values[rowIdx][cols[rangeIdx]] = rows[rowIdx].values ? formatCell(rows[rowIdx].values[0]) : '';
      }
    }
  }
}

/**
 * Fetches a google sheet from the external source.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
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
    const tabular = new Google(sheetsClient, id, context.attributes.googleApiOpts)
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
