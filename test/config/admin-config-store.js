/*
 * Copyright 2043 Adobe. All rights reserved.
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
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';
import { AdminConfigStore } from '../../src/config/admin-config-store.js';

describe('Admin Config Store Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  describe('constructor', () => {
    it('constructor fails with slashes in args', async () => {
      assert.throws(() => new AdminConfigStore('o/rg', 'type', 'name'));
      assert.throws(() => new AdminConfigStore('org', 'ty/pe', 'name'));
      assert.throws(() => new AdminConfigStore('org', 'type', 'na/me'));
    });

    it('constructor uses default arguments', async () => {
      assert.throws(() => new AdminConfigStore());
      const cs = new AdminConfigStore('org');
      assert.ok(cs.now);
      assert.deepEqual(cs, {
        key: '/orgs/org/config.json',
        name: '',
        org: 'org',
        type: 'org',
        now: cs.now,
        isAdmin: false,
        isOps: false,
        listDetails: false,
      });
    });

    it('constructor uses arguments', async () => {
      assert.throws(() => new AdminConfigStore());
      const cs = new AdminConfigStore('org', 'profiles', 'profile1');
      assert.ok(cs.now);
      assert.deepEqual(cs, {
        key: '/orgs/org/profiles/profile1.json',
        name: 'profile1',
        org: 'org',
        type: 'profiles',
        now: cs.now,
        isAdmin: false,
        isOps: false,
        listDetails: false,
      });
    });
  });

  function setupTest(suffix) {
    return {
      context: createContext(suffix, {
        // data,
        env: {
          HELIX_STORAGE_DISABLE_R2: 'true',
        },
      }),
      info: createInfo(suffix),
    };
  }

  describe('read', () => {
    it('returns data from storage', async () => {
      nock.config()
        .getObject('/orgs/org/profiles/profile1.json')
        .reply(200, '{}');

      const cs = new AdminConfigStore('org', 'profiles', 'profile1');
      const { context } = setupTest('/org/profiles/profile1.json');
      const result = await cs.fetchRead(context);

      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(await result.json(), {});
    });

    it('read returns sub-structure from storage', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site1.json')
        .reply(200, SITE_CONFIG);

      const cs = new AdminConfigStore('org', 'sites', 'site1');
      const { context } = setupTest('/org/sites/site1/config');
      const result = await cs.fetchRead(context, 'content');

      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(await result.json(), SITE_CONFIG.content);
    });

    it('read rejects invalid sub-structure from storage', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site1.json')
        .reply(200, SITE_CONFIG);

      const cs = new AdminConfigStore('org', 'sites', 'site1');
      const { context } = setupTest('/org/sites/site1/config');
      const result = await cs.fetchRead(context, 'foobar');

      assert.strictEqual(result.status, 400);
    });

    it('read returns 404', async () => {
      nock.config()
        .getObject('/orgs/org/profiles/profile1.json')
        .reply(404);

      const cs = new AdminConfigStore('org', 'profiles', 'profile1');
      const { context } = setupTest('/org/profiles/profile1.json');
      const result = await cs.fetchRead(context);

      assert.strictEqual(result.status, 404);
    });
  });
});
