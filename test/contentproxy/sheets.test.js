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
/* eslint-env mocha */
import assert from 'assert';
import { getSheetNamesForMetadata } from '../../src/contentproxy/sheets.js';

const MAX_SHEET_NUM = 5;

describe('Shortened Sheet Names to save in header metadata', () => {
  it('getSheetNamesForMetadata returns only MAX_NUM sheets if it has more than MAX_NUM sheets', async () => {
    const sheetNames = ['Sheet1', 'Sheet2', 'Sheet3', 'Sheet4', 'Sheet5', 'Sheet6', 'Sheet7'];
    const shortenedSheetNames = getSheetNamesForMetadata(sheetNames, MAX_SHEET_NUM);
    assert.deepStrictEqual(shortenedSheetNames, ['Sheet1', 'Sheet2', 'Sheet3', 'Sheet4', 'Sheet5', '...']);
  });

  it('getSheetNamesForMetadata returns incoming, helix-default and shared-default sheets if they exist at the beginning', async () => {
    const sheetNames = ['Sheet1', 'Sheet2', 'Sheet3', 'incoming', 'Sheet5', 'Sheet6', 'helix-default', 'shared-default'];
    const shortenedSheetNames = getSheetNamesForMetadata(sheetNames, MAX_SHEET_NUM);
    assert.deepStrictEqual(shortenedSheetNames, ['incoming', 'helix-default', 'shared-default', 'Sheet1', 'Sheet2', '...']);
  });

  it('getSheetNamesForMetadata returns incoming OR helix-default or shared-default sheets if either exist at the beginning', async () => {
    const sheetNames = ['Sheet1', 'Sheet2', 'Sheet3', 'incoming', 'Sheet5', 'Sheet6', 'Sheet7'];
    const shortenedSheetNames = getSheetNamesForMetadata(sheetNames, MAX_SHEET_NUM);
    assert.deepStrictEqual(shortenedSheetNames, ['incoming', 'Sheet1', 'Sheet2', 'Sheet3', 'Sheet5', '...']);
  });

  it('getSheetNamesForMetadata returns incoming OR helix-default or shared-default sheets if either exist at the beginning', async () => {
    const sheetNames = ['helix-default', 'Sheet1', 'Sheet2', 'Sheet3', 'Sheet4', 'Sheet5', 'Sheet6'];
    const shortenedSheetNames = getSheetNamesForMetadata(sheetNames, MAX_SHEET_NUM);
    assert.deepStrictEqual(shortenedSheetNames, ['helix-default', 'Sheet1', 'Sheet2', 'Sheet3', 'Sheet4', '...']);
  });

  it('getSheetNamesForMetadata returns incoming OR helix-default or shared-default sheets if either exist at the beginning', async () => {
    const sheetNames = ['Sheet1', 'Sheet2', 'Sheet3', 'Sheet4', 'Sheet5', 'Sheet6', 'shared-default'];
    const shortenedSheetNames = getSheetNamesForMetadata(sheetNames, MAX_SHEET_NUM);
    assert.deepStrictEqual(shortenedSheetNames, ['shared-default', 'Sheet1', 'Sheet2', 'Sheet3', 'Sheet4', '...']);
  });

  it('getSheetNamesForMetadata returns sheets as-is if number of sheet name is lower than MAX_NUM', async () => {
    const sheetNames = ['Sheet1', 'Sheet2', 'incoming', 'helix-default'];
    const shortenedSheetNames = getSheetNamesForMetadata(sheetNames, MAX_SHEET_NUM);
    assert.deepStrictEqual(shortenedSheetNames, ['Sheet1', 'Sheet2', 'incoming', 'helix-default']);
  });
});
