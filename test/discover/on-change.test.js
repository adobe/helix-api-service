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
import discover from '../../src/discover/on-change.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

describe('Discover on change Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('../../src/discover/Inventory.js').Inventory} */
  let inventory;

  beforeEach(() => {
    nock = new Nock().env();

    nock.content('default')
      .putObject('/inventory-v2.json')
      .optionally(true)
      .reply((_, body) => {
        inventory = body;
        return [201];
      });
  });

  afterEach(() => {
    inventory = null;

    nock.done();
  });

  function setupTest() {
    const suffix = '/org/sites/site1/config.json';
    return {
      context: createContext(suffix, {
        env: {
          HELIX_STORAGE_DISABLE_R2: 'true',
        },
      }),
      info: createInfo(suffix),
    };
  }

  it('add a new project', async () => {
    nock.content('default')
      .getObject('/inventory-v2.json')
      .reply(404);

    nock.siteConfig(SITE_CONFIG);
    nock.content()
      .getObject('/.hlx.json')
      .reply(404);

    const { context } = setupTest();
    await discover.projectChanged(context, null, SITE_CONFIG, 'org', 'site');

    assert.strictEqual(inventory.entries.length, 1);
  });

  it('remove a project', async () => {
    nock.content('default')
      .getObject('/inventory-v2.json')
      .reply(200, {
        entries: [{
          org: 'org',
          site: 'site',
        }],
      });

    const { context } = setupTest();
    await discover.projectChanged(context, SITE_CONFIG, null, 'org', 'site');

    assert.strictEqual(inventory.entries.length, 0);
  });

  it('replace a project', async () => {
    const newConfig = {
      ...SITE_CONFIG,
      content: {
        ...SITE_CONFIG.content,
        contentBusId: 'new-content-bus-id',
      },
    };
    nock.content('default')
      .getObject('/inventory-v2.json')
      .reply(200, {
        entries: [{
          org: 'org',
          site: 'site',
        }],
      });
    nock.siteConfig(newConfig);
    nock.content('new-content-bus-id')
      .getObject('/.hlx.json')
      .reply(404);

    const { context } = setupTest();
    await discover.projectChanged(context, SITE_CONFIG, newConfig, 'org', 'site');

    assert.deepStrictEqual(inventory.entries, [{
      codeBusId: 'owner/repo',
      contentBusId: 'new-content-bus-id',
      contentSourceUrl: newConfig.content.source.url,
      gdriveId: newConfig.content.source.id,
      org: 'org',
      site: 'site',
    }]);
  });

  it('leave a project unchanged', async () => {
    const { context } = setupTest();
    await discover.projectChanged(context, SITE_CONFIG, SITE_CONFIG, 'org', 'site');

    assert.strictEqual(inventory, null);
  });
});
