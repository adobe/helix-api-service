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
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';

const INDEX_CONFIG = `
indices:
  default:
    exclude:
    - '/drafts/**'
    target: /query-index.json
    properties:
      title:
        select: head > meta[property="og:title"]
        value: |
          attribute(el, 'content')
      lastModified:
        select: none
        value: |
          parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')
`;

describe('Index Remove Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {object[]} */
  const entries = [];

  beforeEach(() => {
    nock = new Nock().env();

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
    nock.sitemapConfig(null);
    nock.sqs('helix-indexer', entries);
    nock.content()
      .head('/live/sitemap.json')
      .reply(404);
  });

  afterEach(() => {
    entries.length = 0;
    nock.done();
  });

  function setupTest(path = '/') {
    const suffix = `/org/sites/site/index${path}`;

    const request = new Request(`https://localhost${suffix}`, {
      method: 'DELETE',
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        retryDelay: 1,
      },
      runtime: {
        accountId: '123456789012',
        region: 'us-east-1',
      },
      env: {
        HELIX_STORAGE_MAX_ATTEMPTS: '1',
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    };
    return { request, context };
  }

  it('removes indexed resource', async () => {
    nock.indexConfig(INDEX_CONFIG);
    nock.content()
      .getObject('/live/query-index.json')
      .reply(200, {
        data: [{
          path: '/document',
        }],
      });
    const { request, context } = setupTest('/document');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(entries, [{
      MessageAttributes: {
        owner: { DataType: 'String', StringValue: 'org' },
        repo: { DataType: 'String', StringValue: 'site' },
      },
      MessageBody: {
        owner: 'org',
        repo: 'site',
        index: 'default',
        record: {
          path: '/document',
        },
        type: 'google',
        deleted: true,
      },
    }]);
  });

  it('ignores resource that is not contained in index', async () => {
    nock.indexConfig(INDEX_CONFIG);
    nock.content()
      .getObject('/live/query-index.json')
      .reply(200, {});

    const { request, context } = setupTest('/drafts/my-draft');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      results: [{
        name: 'default',
        result: {
          message: 'requested path does not match index configuration',
          path: '/drafts/my-draft',
        },
        type: 'google',
      }],
      resourcePath: '/drafts/my-draft.md',
      webPath: '/drafts/my-draft',
    });
    assert.deepStrictEqual(entries, []);
  });
});
