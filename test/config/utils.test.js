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
import { loadOrgConfig, loadSiteConfig, getUserListPaths } from '../../src/config/utils.js';
import { Nock, createContext, SITE_CONFIG } from '../utils.js';

describe('Config Utils Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('../utils.js').AdminContext} */
  let context;

  beforeEach(() => {
    nock = new Nock().env();
    context = createContext('/org/sites/site/status/index.md');
  });

  afterEach(() => {
    nock.done();
  });

  it('return null for non 404 error config response', async () => {
    nock.siteConfig()
      .reply(500);

    const config = await loadSiteConfig(context, 'org', 'site');
    assert.strictEqual(config, null);
  });

  it('throws error for error config', async () => {
    nock.siteConfig()
      .replyWithError(new Error('boom!'));

    const task = loadSiteConfig(context, 'org', 'site');
    await assert.rejects(
      task,
      /Fetching site config from https:\/\/config.aem.page\/main--site--org\/config.json\?scope=admin failed: boom!/,
    );
  });

  it('return null for non 404 error org config response', async () => {
    nock.orgConfig()
      .reply(500);

    const config = await loadOrgConfig(context, 'org');
    assert.strictEqual(config, null);
  });

  it('throws error for error config', async () => {
    nock.orgConfig()
      .replyWithError(new Error('boom!'));

    const task = loadOrgConfig(context, 'org', 'site');
    await assert.rejects(
      task,
      /Fetching org config from https:\/\/config.aem.page\/org\/config.json\?scope=admin failed: boom!/,
    );
  });
});

describe('getUserListPaths', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('returns the correct paths', async () => {
    const access = { admin: { role: { editor: ['/editor'] } } };
    const context = createContext('/org/sites/site/status/index.md', {
      attributes: {
        config: {
          ...SITE_CONFIG,
          access,
        },
      },
    });
    const paths = await getUserListPaths(context);
    assert.deepStrictEqual(paths, ['/editor']);
  });
});
