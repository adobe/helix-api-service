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
import sinon from 'sinon';
import purge from '../../src/cache/purge.js';
import discover from '../../src/discover/reindex.js';
import { AdminConfigStore } from '../../src/config/admin-config-store.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

const CONTENT_BUS_ID = SITE_CONFIG.content.contentBusId;

function copyDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

describe('Admin Config Store Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  /** @type {import('../../src/cache/purge.js').PurgeInfo[]} */
  let purgeInfos;

  /** @type {object} */
  let projectInfo;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();

    sandbox.stub(purge, 'config').callsFake((context, opts) => {
      purgeInfos = opts;
    });
    sandbox.stub(discover, 'projectChanged').callsFake((context, oldConfig, newConfig, org, site) => {
      projectInfo = {
        oldConfig, newConfig, org, site,
      };
    });
  });

  afterEach(() => {
    projectInfo = null;
    purgeInfos = null;

    sandbox.restore();
    nock.done();
  });

  describe('constructor', () => {
    it('fails with slashes in args', async () => {
      assert.throws(() => new AdminConfigStore('o/rg', 'type', 'name'));
      assert.throws(() => new AdminConfigStore('org', 'ty/pe', 'name'));
      assert.throws(() => new AdminConfigStore('org', 'type', 'na/me'));
    });

    it('uses default arguments', async () => {
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

    it('uses arguments', async () => {
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

  function setupTest(suffix, {
    data = undefined, env = {},
  } = {}) {
    return {
      context: createContext(suffix, {
        attributes: {
          infoMarkerChecked: true,
        },
        data,
        env: {
          HELIX_STORAGE_DISABLE_R2: 'true',
          ...env,
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

    it('returns sub-structure from storage', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site1.json')
        .reply(200, SITE_CONFIG);

      const cs = new AdminConfigStore('org', 'sites', 'site1');
      const { context } = setupTest('/org/sites/site1/config.json');
      const result = await cs.fetchRead(context, 'content');

      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(await result.json(), SITE_CONFIG.content);
    });

    it('rejects invalid sub-structure from storage', async () => {
      nock.config()
        .getObject('/orgs/org/sites/site1.json')
        .reply(200, SITE_CONFIG);

      const cs = new AdminConfigStore('org', 'sites', 'site1');
      const { context } = setupTest('/org/sites/site1/config.json');
      const result = await cs.fetchRead(context, 'foobar');

      assert.strictEqual(result.status, 400);
    });

    it('returns 404', async () => {
      nock.config()
        .getObject('/orgs/org/profiles/profile1.json')
        .reply(404);

      const cs = new AdminConfigStore('org', 'profiles', 'profile1');
      const { context } = setupTest('/org/profiles/profile1.json');
      const result = await cs.fetchRead(context);

      assert.strictEqual(result.status, 404);
    });
  });

  describe('create', () => {
    it('stores new data in storage', async () => {
      nock.versions();
      nock.config()
        .getObject('/orgs/org/profiles/default.json')
        .reply(404)
        .headObject('/orgs/org/sites/site.json')
        .reply(404)
        .putObject('/orgs/org/sites/site.json')
        .reply(201);

      const cs = new AdminConfigStore('org', 'sites', 'site');
      cs.now = new Date(Date.UTC(2024, 0, 1));

      const { context } = setupTest('/org/sites/site/config.json', {
        data: copyDeep(SITE_CONFIG),
      });
      const result = await cs.fetchCreate(context);

      assert.strictEqual(result.status, 201);
      assert.deepStrictEqual(purgeInfos, {
        org: 'org',
        site: 'site',
        owner: 'owner',
        repo: 'repo',
        keys: [
          'main--repo--owner_code',
          CONTENT_BUS_ID,
          `p_${CONTENT_BUS_ID}`,
        ],
      });
      assert.deepStrictEqual(projectInfo, {
        oldConfig: null,
        newConfig: {
          ...SITE_CONFIG,
          created: cs.now.toISOString(),
          lastModified: cs.now.toISOString(),
        },
        org: 'org',
        site: 'site',
      });
    });

    it('rejects locked content source', async () => {
      nock.config()
        .getObject('/orgs/org/profiles/default.json')
        .reply(404)
        .headObject('/orgs/org/sites/site.json')
        .reply(404);

      const cs = new AdminConfigStore('org', 'sites', 'site');
      const { context } = setupTest('/org/sites/site/config.json', {
        data: copyDeep(SITE_CONFIG),
        env: {
          HLX_CONTENT_SOURCE_LOCK: JSON.stringify({
            'drive.google.com': [],
          }),
        },
      });
      const result = await cs.fetchCreate(context);

      assert.strictEqual(result.status, 400);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'Error creating config: access for org/site to drive.google.com denied by tenant lock',
        'x-error-code': 'AEM_BACKEND_CONFIG_CREATE',
      });
    });

    it('returns 409 if config already exists in storage', async () => {
      nock.config()
        .headObject('/orgs/org/profiles/profile1.json')
        .reply(200);

      const cs = new AdminConfigStore('org', 'profiles', 'profile1');
      const { context } = setupTest('/org/profiles/profile1.json');
      const result = await cs.fetchCreate(context);

      assert.strictEqual(result.status, 409);
    });

    it('returns 400 for invalid config', async () => {
      nock.config()
        .headObject('/orgs/org/sites/site.json')
        .reply(404)
        .getObject('/orgs/org/profiles/default.json')
        .reply(404);

      const cs = new AdminConfigStore('org', 'sites', 'site');
      const { context } = setupTest('/org/sites/site/config.json', {
        data: { invalid: 'config' },
      });
      const result = await cs.fetchCreate(context);

      assert.strictEqual(result.status, 400);
      assert.deepStrictEqual(result.headers.plain(), {
        'cache-control': 'no-store, private, must-revalidate',
        'content-type': 'text/plain; charset=utf-8',
        'x-error': 'Error creating config: data must have required properties: [content, code]; data must NOT have additional properties',
        'x-error-code': 'AEM_BACKEND_CONFIG_CREATE',
      });
    });
  });

  describe('update', () => {
    it('profile in storage', async () => {
      nock.versions('profiles', 'org', 'profile1');
      nock.config()
        .getObject('/orgs/org/profiles/profile1.json')
        .reply(404)
        .putObject('/orgs/org/profiles/profile1.json')
        .reply(201);

      const cs = new AdminConfigStore('org', 'profiles', 'profile1');
      cs.now = new Date(Date.UTC(2024, 0, 1));

      const { context } = setupTest('/org/profiles/profile1.json', {
        data: {
          title: 'my profile',
        },
      });
      const result = await cs.fetchUpdate(context);

      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(await result.json(), {
        title: 'my profile',
        version: 1,
        created: cs.now.toISOString(),
        lastModified: cs.now.toISOString(),
      });
    });

    it('list of tokens in site', async () => {
      nock.versions('sites', 'org', 'site1');
      nock.config()
        .getObject('/orgs/org/sites/site1.json')
        .reply(200, SITE_CONFIG)
        .getObject('/orgs/org/profiles/default.json')
        .reply(404)
        .putObject('/orgs/org/sites/site1.json')
        .reply(201);

      const cs = new AdminConfigStore('org', 'sites', 'site1');
      const { context } = setupTest('/org/sites/site1/config.json', {
        data: {},
      });
      const result = await cs.fetchUpdate(context, 'tokens');

      assert.strictEqual(result.status, 200);
      const res = await result.json();
      assert.ok(res.created);
      assert.ok(res.id);
      assert.ok(res.value);
    });
  });
});
