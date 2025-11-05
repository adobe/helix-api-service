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

import { error } from '../../src/contentproxy/errors.js';

describe('Errors Tests', () => {
  it('Retrieves a message and code', async () => {
    const message = error(
      'Unable to fetch \'$1\' from \'$2\': $3',
      'a',
      'b',
      'c',
    );
    assert.deepStrictEqual(message, {
      code: 'AEM_BACKEND_FETCH_FAILED',
      message: 'Unable to fetch \'a\' from \'b\': c',
    });
  });

  it('Retrieves an error with no matching template', async () => {
    const message = error(
      'We tried \'$1\' but \'$2\' happened: $3',
      'a',
      'b',
      'c',
    );
    assert.deepStrictEqual(message, {
      message: 'We tried \'a\' but \'b\' happened: c',
    });
  });
});
