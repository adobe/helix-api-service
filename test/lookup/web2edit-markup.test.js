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
import sinon from 'sinon';
import handler from '../../src/lookup/web2edit-markup.js';
import {
  Nock, createContext, createInfo,
} from '../utils.js';

describe('web2edit Markup Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  function setupTest(path) {
    const suffix = `/owner/sites/repo/status${path}`;
    const context = createContext(suffix, {
      data: {
        editUrl: 'auto',
      },
    });
    const info = createInfo(suffix);
    return { context, info };
  }

  it('succeeds to lookup page', async () => {
    const source = {
      type: 'markup',
      url: 'https://content.da.live/org/site/',
    };

    nock('https://content.da.live:443')
      .get('/org/site/page')
      .reply(200);

    const { context, info } = setupTest('/page');
    const result = await handler.lookup(context, info, source);

    assert.deepStrictEqual(result, {
      editUrl: 'https://da.live/edit#/org/site/page',
      resourcePath: '/page.md',
      sourceLocation: 'markup:https://content.da.live/org/site/page',
      status: 200,
      webPath: '/page',
    });
  });

  it('succeeds to lookup page ending with a `/`', async () => {
    const source = {
      type: 'markup',
      url: 'https://content.da.live/org/site/',
    };

    nock('https://content.da.live:443')
      .get('/org/site/page/')
      .reply(200);

    const { context, info } = setupTest('/page/');
    const result = await handler.lookup(context, info, source);

    assert.deepStrictEqual(result, {
      editUrl: 'https://da.live/edit#/org/site/page/index',
      resourcePath: '/page/index.md',
      sourceLocation: 'markup:https://content.da.live/org/site/page/',
      status: 200,
      webPath: '/page/',
    });
  });

  it('returns error when `url` does not match', async () => {
    const source = {
      url: 'https://www.example.com/',
    };

    const { context, info } = setupTest('/page');
    const result = await handler.lookup(context, info, source);

    assert.deepStrictEqual(result, {
      error: 'Mountpoint not supported: https://www.example.com/.',
      status: 405,
    });
  });
});
