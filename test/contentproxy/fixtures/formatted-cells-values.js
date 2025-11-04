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

export function getFormattedCellsValues(defaultSharedSheetName) {
  return {
    range: `'${defaultSharedSheetName}'!A1:Z1000`,
    majorDimension: 'ROWS',
    values: [
      ['Content', 'Text (formatted)'],
      [
        'gdrive-/main/spreadsheet.gsheet',
        'This is bold and this is italic and this is inline code.',
      ],
      [
        'format but col is not.',
        'more code. bold and italic and underline and strike. adobe.com. end.',
      ],
      ['', 'no formats'],
      ['multiple links test', 'Adobe Link\nHelix Link\nAdobe Link'],
      [
        'multiple links test with ending content',
        'Adobe Link\nHelix Link\nAdobe Link\nNo Link',
      ],
      ['entire cell is a link', 'link'],
      ['this is an empty cell'],
      ['entire cell is bold and italic', 'Italic and Bold'],
      [
        'Test link and underline offsets wrong.',
        'Test link and underline offsets wrong.',
      ],
      ['consecutive links', 'link1link2'],
      ['empty cell at end of rows'],
    ],
  };
}
