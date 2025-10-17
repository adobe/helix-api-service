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

  nocker.done = () => {
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

  nocker.siteConfig = ({ org = 'owner', site = 'repo' } = {}) => nock('https://config.aem.page')
    .get(`/main--${site}--${org}/config.json?scope=admin`);

  nocker.orgConfig = ({ org = 'owner' } = {}) => nock('https://config.aem.page')
    .get(`/${org}/config.json?scope=admin`);

  nock.disableNetConnect();
  return nocker;
}
