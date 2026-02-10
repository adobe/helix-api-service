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
import xml2js from 'xml2js';
import { AccessDeniedError } from '../../src/auth/AccessDeniedError.js';
import { AuthInfo } from '../../src/auth/auth-info.js';
import listBranches from '../../src/code/list-branches.js';
import { Nock } from '../utils.js';

describe('Code List Branches Tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('list branches returns list of branches', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/?delimiter=%2F&list-type=2&prefix=owner%2Frepo%2F')
      .reply(() => [200, new xml2js.Builder().buildObject({
        ListBucketResult: {
          Name: 'helix-code-bus',
          Prefix: 'owner/repo/',
          KeyCount: 3,
          CommonPrefixes: [
            { Prefix: 'owner/repo/main/' },
            { Prefix: 'owner/repo/dev/' },
            { Prefix: 'owner/repo/feature-123/' },
          ],
        },
      })]);

    const result = await listBranches(DEFAULT_CONTEXT({
      attributes: {
        authInfo: AuthInfo.Admin(),
      },
    }), createPathInfo('/code/owner/repo/*'));
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(
      await result.json(),
      {
        branches: [
          '/code/owner/repo/main/',
          '/code/owner/repo/dev/',
          '/code/owner/repo/feature-123/',
        ],
        owner: 'owner',
        repo: 'repo',
      },
    );
  });

  it('list branches needs code:read permissions', async () => {
    await assert.rejects(listBranches({
      log: console,
      attributes: {
        authInfo: new AuthInfo(),
      },
    }, {}), new AccessDeniedError('code:read'));
  });
});
