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

import { createInfo, Nock } from '../utils.js';
import { setupContext } from './testutils.js';
import { createVersion } from '../../src/source/versions.js';
import { getS3KeyFromInfo } from '../../src/source/utils.js';

describe('Source Versions Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('test createVersion with no index.json', async () => {
    function putFN(url, body) {
      assert.equal(body.next, 2);
      assert.equal(body.versions.length, 1);
      assert.equal(body.versions[0].version, 1);
      assert.equal(body.versions[0].user, 'joe@bloggs.org');

      const date = new Date(body.versions[0].date);
      assert(Date.now() - date.getTime() < 1000, 'date is within 1 second of now');
    }

    nock.source()
      .getObject('/myorg/mysite/toast/jam.html/.versions/index.json')
      .reply(404);
    nock.source()
      .copyObject('/myorg/mysite/toast/jam.html/.versions/1')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/myorg/mysite/toast/jam.html')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '998877',
        },
      }));
    nock.source()
      .putObject('/myorg/mysite/toast/jam.html/.versions/index.json')
      .reply(201, putFN);

    const path = '/myorg/sites/mysite/source/toast/jam.html';
    const context = setupContext(path, {
      attributes: {
        authInfo: {
          profile: {
            email: 'joe@bloggs.org',
          },
        },
      },
    });
    const info = createInfo(path);
    const baseKey = getS3KeyFromInfo(info);
    const resp = await createVersion(context, baseKey);
    assert.equal(resp.status, 201);
  });

  it('test createVersion', async () => {
    const indexJson = {
      next: 3,
      versions: [
        {
          version: 1,
          date: '2026-02-17T10:00:00.000Z',
          user: 'test@example.com',
          comment: 'some comment',
          operation: 'preview',
        },
        {
          version: 2,
          date: '2026-02-17T11:22:33.456Z',
          user: 'anonymous',
        },
      ],
    };

    function putFN(url, body) {
      assert.equal(body.next, 4);
      assert.equal(body.versions.length, 3);
      assert.equal(body.versions[2].version, 3);
      assert.equal(body.versions[2].comment, 'test comment');
      assert.equal(body.versions[2].operation, 'version');
      assert.equal(body.versions[2].user, 'anonymous');

      const date = new Date(body.versions[2].date);
      assert(Date.now() - date.getTime() < 1000, 'date is within 1 second of now');

      // compare the pre-existing versions
      assert.deepStrictEqual(body.versions[0], indexJson.versions[0]);
      assert.deepStrictEqual(body.versions[1], indexJson.versions[1]);
    }

    nock.source()
      .getObject('/myorg/mysite/toast/jam.html/.versions/index.json')
      .reply(200, JSON.stringify(indexJson));
    nock.source()
      .copyObject('/myorg/mysite/toast/jam.html/.versions/3')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/myorg/mysite/toast/jam.html')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: '123',
        },
      }));
    nock.source()
      .putObject('/myorg/mysite/toast/jam.html/.versions/index.json')
      .reply(201, putFN);

    const path = '/myorg/sites/mysite/source/toast/jam.html';
    const context = setupContext(path, {
      data: {
        comment: 'test comment',
        operation: 'version',
      },
    });
    const info = createInfo(path);
    const baseKey = getS3KeyFromInfo(info);
    const resp = await createVersion(context, baseKey);
    assert.equal(resp.status, 201);
  });
});
