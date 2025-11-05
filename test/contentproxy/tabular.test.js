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
/* eslint-disable class-methods-use-this */
import assert from 'assert';
import Tabular from '../../src/contentproxy/Tabular.js';

describe('Tabular Tests', () => {
  it('getRows returns empty array', async () => {
    const tabular = new Tabular().withLog(console);
    assert.deepStrictEqual(await tabular.getRows('foo', 'bar'), []);
  });

  it('getData for empty sheet returns empty (helix-default)', async () => {
    const tabular = new Tabular().withLog(console);
    assert.deepStrictEqual(await tabular.getData('helix-default'), []);
  });

  it('getData for empty sheet returns empty (shared-default)', async () => {
    const tabular = new Tabular().withLog(console);
    assert.deepStrictEqual(await tabular.getData('shared-default'), []);
  });

  it('getData can handle undefined rows (helix-default)', async () => {
    const tabular = new Tabular().withLog(console);
    tabular.getRows = () => undefined;
    assert.deepStrictEqual(await tabular.getData('helix-default'), []);
  });

  it('getData can handle undefined rows (shared-default)', async () => {
    const tabular = new Tabular().withLog(console);
    tabular.getRows = () => undefined;
    assert.deepStrictEqual(await tabular.getData('shared-default'), []);
  });

  it('selectSharedSheetNames empty array for no sheets', async () => {
    assert.deepStrictEqual(Tabular.selectSharedSheetNames(), []);
  });

  it('selectSharedSheetNames returns first sheet for non helix sheets', async () => {
    assert.deepStrictEqual(Tabular.selectSharedSheetNames(['Sheet1', 'Sheet2']), ['Sheet1']);
  });

  it('selectSharedSheetNames returns first sheet if non requested with undefined', async () => {
    assert.deepStrictEqual(Tabular.selectSharedSheetNames(['Sheet1', 'Sheet2']), ['Sheet1']);
  });

  it('selectSharedSheetNames returns all helix sheets ', async () => {
    assert.deepStrictEqual(Tabular.selectSharedSheetNames(['Sheet1', 'Sheet2', 'helix-one', 'helix-two']), ['helix-one', 'helix-two']);
  });

  it('selectSharedSheetNames never returns incoming sheet when only sheet in workbook', async () => {
    assert.deepStrictEqual(Tabular.selectSharedSheetNames(['incoming']), []);
  });

  it('selectSharedSheetNames never returns incoming sheet when included in a list of sheets ', async () => {
    assert.deepStrictEqual(Tabular.selectSharedSheetNames(['Sheet1', 'Sheet2', 'incoming', 'helix-one', 'helix-two']), ['helix-one', 'helix-two']);
  });

  it('getSheetNames returns empty array', async () => {
    const tabular = new Tabular().withLog(console);
    assert.deepStrictEqual(await tabular.getSheetNames(), []);
  });
});
