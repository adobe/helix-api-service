/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import assert from 'assert';
import nock from 'nock';

import { Request } from '@adobe/fetch';

import { AuthInfo } from '../src/auth/auth-info.js';
import { router } from '../src/index.js';
import { AdminContext } from '../src/support/AdminContext.js';
import { RequestInfo } from '../src/support/RequestInfo.js';
import { OneDriveNock } from './nocks/onedrive.js';
import { GoogleNock } from './nocks/google.js';

export const SITE_CONFIG = {
  version: 1,
  title: 'Sample site',
  content: {
    name: 'sample-site',
    contentBusId: '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
    source: {
      type: 'google',
      url: 'https://drive.google.com/drive/u/0/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
      id: '18G2V_SZflhaBrSo_0fMYqhGaEF9Vetky',
    },
  },
  code: {
    owner: 'owner',
    repo: 'repo',
    source: {
      type: 'github',
      url: 'https://github.com/owner/repo',
    },
  },
  headers: {
    '/tools/sidekick/**': [{
      key: 'access-control-allow-origin',
      value: '/.*/',
    }],
  },
  cdn: {
    prod: {
      host: 'host.live',
    },
  },
};

export const ORG_CONFIG = {
  org: 'org',
  version: 1,
  access: {
    admin: {
      role: {
        admin: [
          'bob@example.com',
        ],
        config: [
          'spacecat@example.com',
        ],
      },
    },
  },
};

export function Nock() {
  /** @type {Record<string, nock.Scope} */
  const scopes = {};

  /** @type {any[]} */
  let unmatched;

  /** @type {object} */
  let savedEnv;

  function noMatchHandler(req) {
    unmatched.push(req);
  }

  /**
   * @param {string} url
   * @returns {nock.Scope}
   */
  function nocker(url) {
    let scope = scopes[url];
    if (!scope) {
      scope = nock(url);
      scopes[url] = scope;
    }
    if (!unmatched) {
      unmatched = [];
      nock.emitter.on('no match', noMatchHandler);
    }
    return scope;
  }

  nocker.env = (overrides = {}) => {
    savedEnv = { ...process.env };
    Object.assign(process.env, {
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'dummy-id',
      AWS_SECRET_ACCESS_KEY: 'dummy-key',
      ...overrides,
    });
    return nocker;
  };

  nocker.done = () => {
    if (savedEnv) {
      process.env = savedEnv;
    }
    if (unmatched) {
      assert.deepStrictEqual(unmatched.map((req) => req.options || req), []);
      nock.emitter.off('no match', noMatchHandler);
    }
    try {
      Object.values(scopes).forEach((s) => s.done());
    } finally {
      nock.cleanAll();
    }
  };

  nocker.s3 = (bucket, prefix) => {
    const scope = nock(`https://${bucket}.s3.us-east-1.amazonaws.com/${prefix}`);
    scope.getObject = (key) => scope.get(key).query({ 'x-id': 'GetObject' });
    scope.putObject = (key) => scope.put(key).query({ 'x-id': 'PutObject' });
    return scope;
  };

  nocker.content = (contentBusId) => nocker.s3('helix-content-bus', contentBusId ?? SITE_CONFIG.content.contentBusId);

  nocker.media = (contentBusId) => nocker.s3('helix-media-bus', contentBusId ?? SITE_CONFIG.content.contentBusId);

  nocker.siteConfig = (config, { org = 'org', site = 'site' } = {}) => {
    const scope = nock('https://config.aem.page').get(`/main--${site}--${org}/config.json?scope=admin`);
    if (config) {
      scope.reply(200, config);
    }
    return scope;
  };

  nocker.orgConfig = (config, { org = 'org' } = {}) => {
    const scope = nock('https://config.aem.page').get(`/${org}/config.json?scope=admin`);
    if (config) {
      scope.reply(200, config);
    }
    return scope;
  };

  nocker.google = (content) => new GoogleNock(nocker, content);
  nocker.onedrive = (content) => new OneDriveNock(nocker, content);

  nock.disableNetConnect();
  return nocker;
}

export function createContext(suffix, {
  attributes = {}, data, env,
} = {}) {
  return AdminContext.create({
    pathInfo: { suffix },
    data,
    env: {
      HELIX_STORAGE_MAX_ATTEMPTS: '1',
      ...env,
    },
  }, {
    attributes: {
      authInfo: AuthInfo.Admin(),
      config: SITE_CONFIG,
      googleApiOpts: { retry: false },
      gracePeriod: 10,
      ...attributes,
    },
  });
}

/**
 * Create a request info based on a suffix.
 *
 * @param {string} suffix
 * @returns {RequestInfo} info
 */
export function createInfo(suffix) {
  return RequestInfo.create(new Request('http://localhost/'), router.match(suffix).variables);
}
