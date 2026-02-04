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
import { HelixStorage } from '@adobe/helix-shared-storage';
import { createContext, createInfo, Nock } from '../utils.js';

describe('AdminContext Utils Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('ensureInfoMarker adds original-site for', async () => {
    nock.content()
      .getObject('/.hlx.json')
      .reply(200, {
        'original-repository': 'owner/repo',
      })
      .putObject('/.hlx.json')
      .reply((uri, body) => {
        assert.deepStrictEqual(body, {
          'original-repository': 'owner/repo',
          'original-site': 'owner/repo',
          mountpoint: 'https://adobe.sharepoint.com/sites/cg-helix/Shared%20Documents',
        });
        return [201];
      });

    const ctx = createContext('/org/sites/site/preview/foo');
    const info = createInfo('/org/sites/site/preview/foo');
    const storage = HelixStorage.fromContext(ctx).contentBus(true);
    await ctx.ensureInfoMarker(info, storage, 'https://adobe.sharepoint.com/sites/cg-helix/Shared%20Documents');
  });
});
