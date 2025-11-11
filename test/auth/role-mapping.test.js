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
import { RoleMapping } from '../../src/auth/role-mapping.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

describe('Role Mapping Test.', () => {
  /** @type {import('./utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  const suffix = '/org/sites/site/status/';

  function setupTest(admin) {
    const context = createContext(suffix, {
      attributes: {
        config: {
          ...SITE_CONFIG,
          access: {
            admin,
          },
        },
      },
    });
    const info = createInfo(suffix).withCode('owner', 'repo');
    return { context, info };
  }

  it('returns default when no config', async () => {
    const { context } = setupTest();

    const roleMapping = await RoleMapping.load(context);
    assert.deepStrictEqual(roleMapping.hasConfigured, false);
  });

  it('returns default when no admin.role key', async () => {
    const { context } = setupTest({
      requireAuth: 'auto',
    });
    const roleMapping = await RoleMapping.load(context);

    assert.deepStrictEqual(roleMapping.hasConfigured, false);
    assert.deepStrictEqual(roleMapping.getRolesForUser('bob'), ['basic_publish']);
  });

  it('returns default when requireAuth is false', async () => {
    const { context } = setupTest({
      requireAuth: 'false',
      role: {
        publish: 'alice',
      },
    });
    const roleMapping = await RoleMapping.load(context);
    assert.deepStrictEqual(roleMapping.hasConfigured, true);
    assert.deepStrictEqual(roleMapping.getRolesForUser('bob'), ['basic_publish']);
  });

  it('returns default when requireAuth is false (boolean)', async () => {
    const { context } = setupTest({
      requireAuth: false,
    });
    const roleMapping = await RoleMapping.load(context);
    assert.deepStrictEqual(roleMapping.requireAuth, 'false');
  });

  it('returns empty roles for no user', async () => {
    assert.deepStrictEqual(new RoleMapping().getRolesForUser(''), []);
  });

  it('returns direct mappings', async () => {
    const { context } = setupTest({
      role: {
        publish: ['Bob', 'alice'],
        author: ['Fred@adobe.com'],
        devel: ['fred@adobe.com'],
      },
    });
    const mapping = await RoleMapping.load(context);

    assert.deepStrictEqual(mapping.hasConfigured, true);
    assert.deepStrictEqual(mapping.getRolesForUser('bob'), ['publish']);
    assert.deepStrictEqual(mapping.getRolesForUser('Alice'), ['publish']);
    assert.deepStrictEqual(mapping.getRolesForUser('fred@adobe.com'), ['author', 'devel']);
    assert.deepStrictEqual(mapping.getRolesForUser('bruce'), []);
    assert.deepStrictEqual(mapping.getUsersForRole('publish'), ['bob', 'alice']);
    assert.deepStrictEqual(mapping.getUsersForRole('author'), ['fred@adobe.com']);
    assert.deepStrictEqual(mapping.getUsersForRole('admin'), []);
  });

  it('supports prefix wildcards', async () => {
    const { context } = setupTest({
      role: {
        publish: ['*@adobe.com', 'alice@adobe.com'],
        author: ['alice@adobe.com'],
      },
    });
    const mapping = await RoleMapping.load(context);
    assert.deepStrictEqual(mapping.getRolesForUser('bob'), []);
    assert.deepStrictEqual(mapping.getRolesForUser('alice@adobe.com'), ['author', 'publish']);
    assert.deepStrictEqual(mapping.getRolesForUser('fred@adobe.com'), ['publish']);
  });

  it('supports global wildcards', async () => {
    const { context } = setupTest({
      role: {
        publish: ['*'],
        author: ['alice@adobe.com'],
      },
    });
    const mapping = await RoleMapping.load(context);
    assert.deepStrictEqual(mapping.getRolesForUser('bob'), ['publish']);
    assert.deepStrictEqual(mapping.getRolesForUser('alice@adobe.com'), ['author', 'publish']);
    assert.deepStrictEqual(mapping.getRolesForUser('fred@adobe.com'), ['publish']);
  });

  it('can set default roles', async () => {
    const { context } = setupTest({
      defaultRole: ['role1', 'role2'],
      role: {
        author: ['bob'],
      },
    });
    const mapping = await RoleMapping.load(context);
    assert.deepStrictEqual(mapping.getRolesForUser('bob'), ['author']);
  });

  it('ignores default roles for non matching user', async () => {
    const { context } = setupTest({
      role: {
        author: ['bob'],
      },
    });
    const mapping = await RoleMapping.load(context);
    assert.deepStrictEqual(mapping.getRolesForUser('alice'), []);
  });

  it.skip('loads extra config', async () => {
    const { context } = setupTest({
      role: {
        publish: ['*@adobe.com', 'publishers.json'],
      },
    });
    const mapping = await RoleMapping.load(context);

    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/publishers.json?x-id=GetObject')
      .reply(200, {
        default: {
          data: [
            { user: 'foo@adobe-rnd.com' },
            { User: 'bar@adobe-rnd.com' },
            { broken: 'bar@adobe-rnd.com' },
          ],
        },
      });

    assert.deepStrictEqual([...mapping.users.keys()], [
      '*@adobe.com',
      'foo@adobe-rnd.com',
      'bar@adobe-rnd.com',
    ]);
  });

  it.skip('loads extra empty config', async () => {
    const { context } = setupTest({
      role: {
        publish: ['*@adobe.com', 'publishers.json'],
      },
    });
    const mapping = await RoleMapping.load(context);

    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/publishers.json?x-id=GetObject')
      .reply(200, {
        notdefault: {
          data: [
            { user: 'foo@adobe-rnd.com' },
          ],
        },
      });

    assert.deepStrictEqual([...mapping.users.keys()], [
      '*@adobe.com',
    ]);
  });

  it.skip('ignores extra missing config', async () => {
    const { context } = setupTest({
      role: {
        publish: ['*@adobe.com', 'publishers.json'],
      },
    });
    const mapping = await RoleMapping.load(context);

    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/foo-id/preview/.helix/publishers.json?x-id=GetObject')
      .reply(404);

    assert.deepStrictEqual([...mapping.users.keys()], [
      '*@adobe.com',
    ]);
  });

  it.skip('ignores extra helix5 group references', async () => {
    const { context } = setupTest({
      role: {
        publish: [
          '*@adobe.com',
          'groups/publishers.json',
          '/groups/publishers.json',
          null,
        ],
      },
    });
    const mapping = await RoleMapping.load(context);
    assert.deepStrictEqual([...mapping.users.keys()], [
      '*@adobe.com',
    ]);
  });
});
