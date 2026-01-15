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
import { errorResponse } from '../support/utils.js';
import Tabular from './Tabular.js';
import { error } from './errors.js';

const TYPE_KEY = ':type';
const VERSION_KEY = ':version';
const NAMES_KEY = ':names';
const MAX_SHEETS_FOR_METADATA = 5;

/**
 * From an array of sheet names, retrieve the `incoming`, `shared-default` and `helix-default`
 * sheets if they exist, or just the first few sheet names defined by `maxSheets` number of sheets.
 * Returns the array of sheet names as-is if neither match.
 *
 * @param {String[]} sheetNames array of sheet names
 * @param {Number} maxSheets number of sheets to return
 * @returns {String[]} metadata header friendly shortened sheet names
 */
export function getSheetNamesForMetadata(sheetNames, maxSheets) {
  if (sheetNames.length <= maxSheets) {
    return sheetNames;
  }
  const matchedItems = sheetNames.filter((name) => name === ('helix-default') || name === ('shared-default') || name === ('incoming'));
  const unMatchedItems = sheetNames.filter((name) => name !== ('helix-default') && name !== ('shared-default') && name !== ('incoming'));
  const shortenedSheetNames = matchedItems.concat(unMatchedItems).slice(0, maxSheets);
  return [...shortenedSheetNames, '...'];
}

/**
 * Returns the sheets response for the tabular data
 * @param {Tabular} tabular tabular implementation
 * @param {Object} hdrs headers
 * @param {import('@adobe/helix-universal').Logger} log logger
 * @returns {Promise<Response>}
 */
export default async function extract(tabular, hdrs, log) {
  try {
    // Fetch all sheets contained in the workbook
    const sheetNames = await tabular.getSheetNames();
    const shortenedSheetNames = getSheetNamesForMetadata(sheetNames, MAX_SHEETS_FOR_METADATA);

    const headers = {
      ...hdrs,
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      'x-sheet-names': String(shortenedSheetNames.map(encodeURIComponent)),
    };

    // Filter to just sheets prefixed with helix- or shared-
    const sharedSheets = Tabular.selectSharedSheetNames(sheetNames);

    log.info(`Using [${sharedSheets}] from ${sheetNames}.`);

    const lastModified = await tabular.getLastModified();
    if (lastModified) {
      headers['last-modified'] = lastModified;
    }

    // always return a multi-sheet
    const ret = {
      [VERSION_KEY]: 3,
      [TYPE_KEY]: 'multi-sheet',
      [NAMES_KEY]: [],
    };

    await Promise.all(sharedSheets.map(async (name) => {
      try {
        const { columns, data } = await tabular.getColumnsAndData(name);
        log.info(`fetched sheet data ${name}: ${data.length} rows.`);

        // Regex to select the valid shared sheet names
        const sharedRegex = /^(helix-|shared-)/;

        // get (helix/shared)-sheets or the first non-helix sheet (which needs to be called default)
        const shortName = name.match(sharedRegex)
          ? name.replace(sharedRegex, '')
          : 'default';
        ret[NAMES_KEY].push(shortName);
        ret[shortName] = {
          total: data.length,
          offset: 0,
          limit: data.length,
          columns,
          data,
        };
      } catch (e) {
        log.error(`error reading ${name}`, e);
        throw e;
      }
    }));

    return new Response(JSON.stringify(ret), {
      headers,
    });
  } catch (e) {
    const headers = {};
    const code = e.statusCode || e.code;
    if (e.rateLimit?.retryAfter) {
      headers['retry-after'] = e.rateLimit?.retryAfter;
      headers['x-severity'] = 'warn';
    } else if (code === 429) {
      headers['x-severity'] = 'warn';
    } else if (code === 501 && e.message === 'We\'re sorry, but something went wrong with this file.') {
      log.warn(`Workbook might be corrupt: ${hdrs['x-source-location']}`);
      headers['x-severity'] = 'warn';
    }
    return errorResponse(log, -code || /* c8 ignore next */ 500, error(
      'Unable to fetch \'$1\' from \'$2\': $3',
      tabular.getResource(),
      tabular.getProviderName(),
      `(${code}) - ${e.message}`,
    ), { headers });
  }
}
