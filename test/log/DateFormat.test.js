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
import DateFormat from '../../src/log/DateFormat.js';

describe('S3 DateFormat tests', () => {
  it('parse works for genuine format', async () => {
    // construct a date where milliseconds are ignored
    const date = new Date();
    date.setMilliseconds(0);

    const s = DateFormat.format(date);
    const parsed = DateFormat.parse(s);

    assert.strictEqual(parsed.getTime(), date.getTime());
  });
});
