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
import { loadSiteConfig } from '../../src/config/utils.js';
import { Nock, SITE_CONFIG } from '../utils.js';

function siteConfig({
  org = 'owner',
  site = 'repo',
} = {}) {
  return this('https://config.aem.page')
    .get(`/main--${site}--${org}/config.json?scope=admin`);
}

describe('Config Utils Tests', () => {
  /** @type {import('../utils.js').nocker} */
  let nock;

  beforeEach(() => {
    nock = new Nock();
    nock.siteConfig = siteConfig.bind(nock);
  });

  afterEach(() => {
    nock.done();
  });

  it('return null for legacy config', async () => {
    nock.siteConfig()
      .reply(200, {
        ...SITE_CONFIG,
        legacy: true,
      });

    const cfg = await loadSiteConfig({
      log: console,
      attributes: {},
      pathInfo: {
        suffix: '/owner/sites/repo/status/index.md',
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    }, 'owner', 'repo');
    assert.deepStrictEqual(cfg, null);
  });

  it('return null for non 404 error config response', async () => {
    nock.siteConfig()
      .reply(500);

    const cfg = await loadSiteConfig({
      log: console,
      attributes: {},
      pathInfo: {
        suffix: '/owner/sites/repo/status/index.md',
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    }, 'owner', 'repo');
    assert.deepStrictEqual(cfg, null);
  });

  it('throws error for error config', async () => {
    nock.siteConfig()
      .replyWithError(new Error('boom!'));

    const task = loadSiteConfig({
      log: console,
      attributes: {},
      pathInfo: {
        suffix: '/owner/sites/repo/status/index.md',
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    }, 'owner', 'repo');
    await assert.rejects(
      task,
      /Fetching config from https:\/\/config.aem.page\/main--repo--owner\/config.json\?scope=admin failed: boom!/,
    );
  });
});

export {
  siteConfig,
};
