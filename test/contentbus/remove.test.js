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
import {
  Nock, createContext, createInfo,
} from '../utils.js';
import remove from '../../src/contentbus/remove.js';

describe('ContentBus Remove Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest() {
    const suffix = '/org/sites/site/preview/';
    return {
      context: createContext(suffix, {
        attributes: {
          infoMarkerChecked: true,
        },
        env: { HELIX_STORAGE_DISABLE_R2: 'true' },
      }),
      info: createInfo(suffix),
    };
  }

  it('removes a content resource', async () => {
    nock.content()
      .head('/preview/index.md')
      .reply(200, '', {
        'x-amz-meta-redirect-location': '/target',
      })
      .putObject('/preview/index.md')
      .reply((_, body) => {
        assert.strictEqual(body, '/target');
        return [201];
      });

    const { context, info } = setupTest();

    const response = await remove(context, info, 'preview');
    assert.deepStrictEqual(response.status, 204);
  });
});
