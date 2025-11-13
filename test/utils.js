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
import crypto from 'crypto';
import nock from 'nock';
import xml2js from 'xml2js';

import { Headers, Request } from '@adobe/fetch';

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
      host: 'www.example.com',
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
    scope.deleteObject = (key) => scope.delete(key).query({ 'x-id': 'DeleteObject' });
    scope.copyObject = (key) => scope.put(key).query({ 'x-id': 'CopyObject' });
    return scope;
  };

  nocker.code = (ref = 'main') => {
    const { owner, repo } = SITE_CONFIG.code;
    const prefix = `${owner}/${repo}/${ref}`;
    return nocker.s3('helix-code-bus', prefix);
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

  nocker.indexConfig = (config) => {
    const scope = nocker.content()
      .getObject('/preview/.helix/query.yaml');

    if (config) {
      scope.reply(200, config);
    } else {
      const notFound = new xml2js.Builder().buildObject({
        Error: {
          Code: 'NoSuchKey',
          Message: 'The specified key does not exist.',
        },
      });
      scope.reply(404, notFound);
    }
  };

  nocker.sitemapConfig = (config) => {
    const scope = nocker.content()
      .getObject('/preview/.helix/sitemap.yaml');

    if (config) {
      scope.reply(200, config);
    } else {
      const notFound = new xml2js.Builder().buildObject({
        Error: {
          Code: 'NoSuchKey',
          Message: 'The specified key does not exist.',
        },
      });
      scope.reply(404, notFound);
    }
  };

  nocker.inventory = (inventory) => {
    const scope = nocker.content('default').getObject('/inventory.json');
    if (inventory) {
      scope.reply(200, inventory);
    }
    return scope;
  };

  nocker.google = (content) => new GoogleNock(nocker, content);
  nocker.onedrive = (content) => new OneDriveNock(nocker, content);

  nocker.sqs = (queue, entries) => nock('https://sqs.us-east-1.amazonaws.com')
    .post('/', (body) => {
      const { QueueUrl = '' } = body;
      return QueueUrl.split('/').at(-1) === queue;
    })
    .reply((_, body) => {
      const { Entries } = JSON.parse(body);
      if (entries) {
        entries.push(...Entries.map(({ MessageAttributes, MessageBody }) => {
          const messageBody = JSON.parse(MessageBody);
          delete messageBody.timestamp;
          return {
            MessageAttributes,
            MessageBody: messageBody,
          };
        }));
      }
      return [200, JSON.stringify({
        MessageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
        MD5OfMessageBody: crypto.createHash('md5').update(body, 'utf-8').digest().toString('hex'),
      })];
    });

  nock.disableNetConnect();
  return nocker;
}

export function createContext(suffix, {
  attributes = {}, data = {}, env,
} = {}) {
  return AdminContext.create({
    pathInfo: { suffix },
    data,
    env: {
      HELIX_STORAGE_MAX_ATTEMPTS: '1',
      ...env,
    },
    runtime: { region: 'us-east-1' },
  }, {
    attributes: {
      authInfo: AuthInfo.Admin(),
      config: SITE_CONFIG,
      googleApiOpts: { retry: false },
      gracePeriod: 1,
      retryDelay: 1,
      ...attributes,
    },
    headers: new Headers({
      'x-request-id': 'rid',
    }),
  });
}

/**
 * Create a request info based on a suffix.
 *
 * @param {string} suffix
 * @returns {RequestInfo} info
 */
export function createInfo(suffix, headers = {}) {
  return RequestInfo.create(new Request('http://localhost/', {
    headers,
  }), router.match(suffix).variables);
}
