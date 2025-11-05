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

export function getFormattedCellsSheet(defaultSharedSheetName) {
  return {
    spreadsheetId: '1xYDo0FpSRyhdxDoHJC2YTTyhOnGTWptoCY50i2qCawY',
    properties: {
      title: 'formatted-cells',
      locale: 'en_US',
      autoRecalc: 'ON_CHANGE',
    },
    sheets: [
      {
        properties: {
          sheetId: 0,
          title: defaultSharedSheetName,
          index: 0,
          sheetType: 'GRID',
          gridProperties: {
            rowCount: 1000,
            columnCount: 26,
          },
        },
      },
    ],
    spreadsheetUrl:
      'https://docs.google.com/spreadsheets/d/1xYDo0FpSRyhdxDoHJC2YTTyhOnGTWptoCY50i2qCawY/edit?ouid=103675773435109138422',
  };
}
