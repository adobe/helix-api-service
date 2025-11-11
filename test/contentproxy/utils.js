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
export const validSheet = (overrides = {}) => ({
  ':type': 'sheet',
  limit: 2,
  total: 2,
  offset: 0,
  data: [{
    index: 0,
    value: 'foo',
  }, {
    index: 1,
    value: 'bar',
  }],
  ...overrides,
});

export const validMultiSheet = ({
  names = ['foo', 'bar'],
  version = 3,
  ...overrides
} = {}) => ({
  ':type': 'multi-sheet',
  ':names': names,
  ':version': version,
  ...(Object.fromEntries(names.map((name) => {
    const sheet = validSheet();
    delete sheet[':type'];
    return [name, sheet];
  }))),
  ...overrides,
});
