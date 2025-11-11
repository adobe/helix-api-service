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
import { AccessDeniedError } from '../../src/auth/AccessDeniedError.js';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { authorize } from '../../src/auth/authzn.js';
import { PERMISSIONS } from '../../src/auth/permissions.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

describe('Authorization Test', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  const CONFIG_NO_ROLES = {
    data: [{
      key: 'admin.secure',
      value: 'true',
    }],
  };

  const CONFIG_PUBLISH_BOB = {
    data: [{
      key: 'admin.role.publish',
      value: 'bob',
    }],
  };

  const CONFIG_PUBLISH_BOB_NOT_REQUIRED = {
    data: [{
      key: 'admin.role.publish',
      value: 'bob',
    }, {
      key: 'admin.requireAuth',
      value: 'false',
    }],
  };

  const CONFIG_AUTH_REQUIRED = {
    data: [{
      key: 'admin.requireAuth',
      value: 'true',
    }],
  };

  const CONFIG_PUBLISH_ALICE = {
    data: [{
      key: 'admin.role.superuser',
      value: 'alice',
    }],
  };

  const CONFIG_DEFAULT_ROLE = {
    data: [{
      key: 'admin.defaultRole',
      value: 'publish',
    }],
  };

  const suffix = '/org/sites/site/status/';

  function toAdminSection(config) {
    if (!config) {
      return {};
    }
    const tree = {};
    config.data.forEach(({ key, value }) => {
      const segs = key.split('.');
      const child = segs.slice(0, -1).reduce((parent, seg) => {
        if (!parent[seg]) {
          // eslint-disable-next-line no-param-reassign
          parent[seg] = Object.create(null);
        }
        return parent[seg];
      }, tree);
      child[segs.at(-1)] = value;
    });
    return tree.admin;
  }

  function setupTest(authInfo, config) {
    const context = createContext(suffix, {
      attributes: {
        authInfo,
        config: {
          ...SITE_CONFIG,
          access: {
            admin: toAdminSection(config),
          },
        },
      },
    });
    const info = createInfo(suffix).withCode('owner', 'repo');
    return { context, info };
  }

  it('uses anonymous default roles with no config', async () => {
    const authInfo = AuthInfo.Default();

    const { context, info } = setupTest(authInfo, CONFIG_NO_ROLES);
    await authorize(context, info);

    assert.deepStrictEqual(authInfo.toJSON(), {
      expired: false,
      loginHint: null,
      profile: null,
      idp: undefined,
      authenticated: false,
      roles: [
        'basic_publish',
      ],
      permissions: [
        ...PERMISSIONS.basic_publish,
      ],
    });
  });

  it('uses provided default roles for authenticated users with no config', async () => {
    const authInfo = AuthInfo.Default().withProfile({ defaultRole: 'publish' });

    const { context, info } = setupTest(authInfo, CONFIG_NO_ROLES);
    await authorize(context, info);

    assert.deepStrictEqual(authInfo.toJSON(), {
      expired: false,
      loginHint: null,
      profile: {
        defaultRole: 'publish',
      },
      idp: undefined,
      authenticated: false,
      roles: [
        'publish',
      ],
      permissions: [
        ...PERMISSIONS.publish,
      ],
    });
  });

  it.skip('rejects missing auth info', async () => {
    // TODO: seems wrong that `authInfo` can be `null`, or isn't it?
    const { context, info } = setupTest(null, null);
    await authorize(context, info);
  });

  it('populates the user roles', async () => {
    const authInfo = AuthInfo.Default()
      .withAuthenticated(true)
      .withProfile({
        email: 'bob',
      });

    const { context, info } = setupTest(authInfo, CONFIG_PUBLISH_BOB);
    await authorize(context, info);

    assert.deepStrictEqual(authInfo.toJSON().roles, ['publish']);
  });

  it('populates the user roles from user_id', async () => {
    const authInfo = AuthInfo.Default()
      .withAuthenticated(true)
      .withProfile({
        user_id: 'bob',
      });

    const { context, info } = setupTest(authInfo, CONFIG_PUBLISH_BOB);
    await authorize(context, info);

    assert.deepStrictEqual(authInfo.toJSON().roles, ['publish']);
  });

  it('populates the user roles from preferred_username', async () => {
    const authInfo = AuthInfo.Default()
      .withAuthenticated(true)
      .withProfile({
        preferred_username: 'bob',
      });

    const { context, info } = setupTest(authInfo, CONFIG_PUBLISH_BOB);
    await authorize(context, info);

    assert.deepStrictEqual(authInfo.toJSON().roles, ['publish']);
  });

  it('rejects secured config with no authentication', async () => {
    const authInfo = AuthInfo.Default();

    const { context, info } = setupTest(authInfo, CONFIG_PUBLISH_BOB);
    await assert.rejects(
      authorize(context, info),
      new AccessDeniedError('not authenticated'),
    );
  });

  it('enforce secured config with no roles', async () => {
    const authInfo = AuthInfo.Default();

    const { context, info } = setupTest(authInfo, CONFIG_AUTH_REQUIRED);
    await assert.rejects(
      authorize(context, info),
      new AccessDeniedError('not authenticated'),
    );
  });

  it('allows secured config with no authentication if configured', async () => {
    const authInfo = AuthInfo.Default();

    const { context, info } = setupTest(authInfo, CONFIG_PUBLISH_BOB_NOT_REQUIRED);
    await authorize(context, info);

    assert.deepStrictEqual(authInfo.toJSON().roles, ['basic_publish']);
  });

  it('ignores user with no matching roles', async () => {
    const authInfo = AuthInfo.Default()
      .withAuthenticated(true)
      .withProfile({
        email: 'alice',
      });

    const { context, info } = setupTest(authInfo, CONFIG_PUBLISH_BOB);
    await authorize(context, info);

    assert.deepStrictEqual(authInfo.toJSON().roles, []);
  });

  it('ignores invalid role in config', async () => {
    const authInfo = AuthInfo.Default()
      .withAuthenticated(true)
      .withProfile({
        email: 'alice',
      });

    const { context, info } = setupTest(authInfo, CONFIG_PUBLISH_ALICE);
    await authorize(context, info);

    assert.deepStrictEqual(authInfo.toJSON().roles, []);
  });

  it('allows to configure the default role', async () => {
    const authInfo = AuthInfo.Default();

    const { context, info } = setupTest(authInfo, CONFIG_DEFAULT_ROLE);
    await authorize(context, info);

    assert.deepStrictEqual(authInfo.toJSON().roles, ['publish']);
  });
});
