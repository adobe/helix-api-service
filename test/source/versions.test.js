/*
 * Copyright 2026 Adobe. All rights reserved.
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
/* eslint-disable no-param-reassign */
import assert from 'assert';
import xml2js from 'xml2js';
import { postVersion } from '../../src/source/versions.js';
import { Nock } from '../utils.js';
import { setupContext } from './testutils.js';

describe('Versions Tests', () => {
  let context;
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    context = setupContext();
    context.config.org = 'myorg';
    context.config.site = 'mysite';

    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('test postVersion', async () => {
    let versionId;

    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .twice()
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
      });

    async function copyFn(u) {
      const path = u.split('?')[0];
      const prefix = '/myorg/mysite/.versions/01KK1E35DP7EQDG9G99QQAVQ1Z/';
      assert(path.startsWith(prefix));
      versionId = path.slice(prefix.length);

      return new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '123',
        },
      });
    }

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .matchHeader('x-amz-copy-source', 'helix-source-bus/myorg/mysite/a/b/c.html')
      .matchHeader('x-amz-metadata-directive', 'REPLACE')
      .matchHeader('x-amz-meta-doc-id', '01KK1E35DP7EQDG9G99QQAVQ1Z')
      .matchHeader('x-amz-meta-doc-path-hint', '/a/b/c.html')
      .matchHeader('x-amz-meta-version-user', 'anonymous')
      .matchHeader('x-amz-meta-version-operation', 'testing')
      .matchHeader('x-amz-meta-version-comment', 'test comment')
      .reply(200, copyFn);

    const resp = await postVersion(context, 'myorg/mysite/a/b/c.html', 'testing', 'test comment');
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('location'), `/myorg/sites/mysite/source/a/b/c.html/.versions/${versionId}`);
  });

  it('test postVersion precondition failed, retry', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .times(4)
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
      });

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .reply(412)
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '123',
        },
      }));

    const resp = await postVersion(context, 'myorg/mysite/a/b/c.html');
    assert.equal(resp.status, 201);
  });

  it('test postVersion precondition failed, too many retries', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .twice()
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
      });

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .reply(412);

    const resp = await postVersion(context, 'myorg/mysite/a/b/c.html', 'abc', 'def', 999);
    assert.equal(resp.status, 412);
  });

  it('test postVersion error', async () => {
    nock.source()
      .headObject('/myorg/mysite/a/b/c.html')
      .twice()
      .reply(200, null, {
        etag: 'foobar',
        'x-amz-meta-doc-id': '01KK1E35DP7EQDG9G99QQAVQ1Z',
      });

    nock.source()
      .copyObject(/myorg\/mysite\/.versions\/01KK1E35DP7EQDG9G99QQAVQ1Z\/.+/)
      .reply(403);

    const resp = await postVersion(context, 'myorg/mysite/a/b/c.html');
    assert.equal(resp.status, 403);
  });
});
