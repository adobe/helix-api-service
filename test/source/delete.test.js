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
/* eslint-disable no-param-reassign */
import assert from 'assert';
import { deleteSource } from '../../src/source/delete.js';
import { createInfo, Nock } from '../utils.js';
import { setupContext } from './testutils.js';

describe('Source Delete Tests', () => {
  let context;
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    context = setupContext();
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('test deleteSource', async () => {
    nock.source()
      .deleteObject('/test/rest/toast/jam.html')
      .reply(204);

    const info = createInfo('/test/sites/rest/source/toast/jam.html');
    const resp = await deleteSource(context, info);
    assert.equal(resp.status, 204);
  });

  it('test deleteSource propagates S3 errors', async () => {
    nock.source()
      .deleteObject('/test/rest/toast/error.html')
      .reply(503);

    const info = createInfo('/test/sites/rest/source/toast/error.html');
    const resp = await deleteSource(context, info);
    assert.equal(resp.status, 503);
  });
});
