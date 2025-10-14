/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
import assert from 'assert';
import { Request } from '@adobe/fetch';
import { main } from '../src/index.js';

describe('Index Tests', () => {
  it('succeeds calling code handler', async () => {
    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/owner/sites/repo/code/main',
      },
    });
    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling code handler with trailing path', async () => {
    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/owner/sites/repo/code/main/src/scripts.js',
      },
    });
    assert.strictEqual(await result.text(), '');
  });

  it('fails calling inexistant handler', async () => {
    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/owner/sites/repo/code',
      },
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });
});
