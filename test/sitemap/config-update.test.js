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
/* eslint-disable max-classes-per-file, class-methods-use-this */

/* eslint-env mocha */
import assert from 'assert';
import YAML from 'yaml';
import zlib from 'zlib';

import { hostUpdated } from '../../src/sitemap/config-update.js';
import { Nock, createContext, createInfo } from '../utils.js';

describe('Sitemap Config Update Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(suffix = '/org/sites/site/sitemap/') {
    const context = createContext(suffix, {
      env: {
        HELIX_STORAGE_DISABLE_R2: 'true',
      },
    });
    const info = createInfo(suffix).withCode('owner', 'repo');
    return { context, info };
  }

  describe('change is ignored', () => {
    it('when new hostname is not provided', async () => {
      const { context, info } = setupTest();

      const result = await hostUpdated(context, info, { new: undefined });
      assert.strictEqual(result, false);
    });

    it('when no sitemap is configured', async () => {
      nock.sitemapConfig(null);
      const { context, info } = setupTest();

      const result = await hostUpdated(context, info, { new: 'www.example.com' });
      assert.strictEqual(result, false);
    });

    it('when fetching sitemap config fails', async () => {
      nock.sitemapConfig(null, {
        code: 'InternalError',
        message: 'An unexpected error occurred',
        status: 500,
      });
      const { context, info } = setupTest();

      const result = await hostUpdated(context, info, { new: 'www.example.com' });
      assert.strictEqual(result, false);
    });
  });

  describe('auto-generated sitemap config', () => {
    const GENERATED_SIMPLE_CONFIG = `
    version: 1
    auto-generated: true

    sitemaps:
      default:
        origin: https://www.example.com
        source: /query-index.json
        destination: /sitemap.xml
    `;

    beforeEach(() => {
      nock.sitemapConfig(GENERATED_SIMPLE_CONFIG);

      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify({
          data: [
            { path: '/page1', lastModified: 1631031300, robots: '' },
          ],
        }))
        .putObject('/preview/sitemap.xml')
        .reply(201)
        .putObject('/live/sitemap.xml')
        .reply(201);
    });

    it('is rewritten when origin did change', async () => {
      nock.content()
        .putObject('/preview/.helix/sitemap.yaml')
        .reply(201, (_uri, body) => {
          const config = YAML.parse(zlib.gunzipSync(Buffer.from(body, 'hex')).toString());
          assert.strictEqual(config.sitemaps.default.origin, 'https://www.neworigin.com');
        });
      const { context, info } = setupTest();

      const result = await hostUpdated(context, info, { new: 'www.neworigin.com' });
      assert.strictEqual(result, true);
    });

    it('is left as-is when origin did not change', async () => {
      const { context, info } = setupTest();

      const result = await hostUpdated(context, info, { new: 'www.example.com' });
      assert.strictEqual(result, true);
    });
  });

  describe('custom sitemap', () => {
    const MANUAL_SITEMAP_CONFIG = `
    version: 1

    sitemaps:
      simple:
        origin: https://www.example.com
        source: /query-index.json
        destination: /sitemap.xml
    `;

    beforeEach(() => {
      nock.sitemapConfig(MANUAL_SITEMAP_CONFIG);

      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, JSON.stringify({
          data: [
            { path: '/page1', lastModified: 1631031300, robots: '' },
          ],
        }))
        .putObject('/preview/sitemap.xml')
        .reply(201)
        .putObject('/live/sitemap.xml')
        .reply(201);
    });

    it('is rebuilt', async () => {
      const { context, info } = setupTest();

      const result = await hostUpdated(context, info, { new: 'www.neworigin.com' });
      assert.strictEqual(result, true);
    });
  });
});
