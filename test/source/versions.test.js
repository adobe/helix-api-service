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

import { HelixStorage } from '@adobe/helix-shared-storage';
import { createContext, createInfo, Nock } from '../utils.js';
import { setupContext } from './testutils.js';
import { postVersion, deleteVersions, getVersions } from '../../src/source/versions.js';
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
    const resp = await postVersion(context, baseKey);
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
    const resp = await postVersion(context, baseKey);
    assert.equal(resp.status, 201);
  });

  it('test createVersion causes error', async () => {
    nock.source()
      .getObject('/myorg/mysite/toast/jam.html/.versions/index.json')
      .reply(400);

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
    const resp = await postVersion(context, baseKey);
    assert.equal(resp.status, 400);
    assert(resp.headers.get('x-error').includes('Error'));
  });

  const BUCKET_LIST_RESULT = `
    <ListBucketResult>
      <Name>my-bucket</Name>
      <Prefix>my-org/my-site/abc/123.html/.versions/</Prefix>
      <Marker></Marker>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>my-org/my-site/abc/123.html/.versions/1</Key>
        <LastModified>2025-01-01T12:34:56.000Z</LastModified>
        <Size>32768</Size>
      </Contents>
      <Contents>
        <Key>my-org/my-site/abc/123.html/.versions/3</Key>
        <LastModified>2025-01-01T12:34:56.000Z</LastModified>
        <Size>111</Size>
      </Contents>
    </ListBucketResult>`;

  it('test deleteVersions', async () => {
    function deleteBodyCheck(body) {
      assert(body.includes('<Delete'));
      assert(body.includes('<Object><Key>my-org/my-site/abc/123.html/.versions/1</Key></Object>'));
      assert(body.includes('<Object><Key>my-org/my-site/abc/123.html/.versions/3</Key></Object>'));
      return true;
    }

    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'my-org/my-site/abc/123.html/.versions',
      })
      .reply(200, Buffer.from(BUCKET_LIST_RESULT));
    nock.source()
      .post('/?delete=', deleteBodyCheck)
      .reply(204, new xml2js.Builder().buildObject({
        DeleteObjectsOutput: {
          Deleted: [
            { Key: 'my-org/my-site/abc/123.html/.versions/1' },
            { Key: 'my-org/my-site/abc/123.html/.versions/3' },
          ],
        },
      }));

    const context = createContext();
    const bucket = HelixStorage.fromContext(context).sourceBus();
    const file = '/my-org/my-site/abc/123.html';

    await deleteVersions(bucket, file);
  });

  it('test listVersions', async () => {
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

    nock.source()
      .getObject('/my-org/my-site/abc/987.html/.versions/index.json')
      .reply(200, JSON.stringify(indexJson), {
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });

    const info = createInfo('/my-org/sites/my-site/source/abc/987.html/.versions');
    const resp = await getVersions(createContext(), info);
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), JSON.stringify(indexJson.versions));
    assert.equal(resp.headers.get('last-modified'), 'Tue, 25 Oct 2022 02:57:46 GMT');
  });

  it('test headVersions', async () => {
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

    nock.source()
      .headObject('/my-org/my-site/abc/987.html/.versions/index.json')
      .reply(200, JSON.stringify(indexJson), {
        'last-modified': 'Tue, 25 Oct 2022 12:57:46 GMT',
      });

    const info = createInfo('/my-org/sites/my-site/source/abc/987.html/.versions');
    const resp = await getVersions(createContext(), info, true);
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), '');
    assert.equal(resp.headers.get('last-modified'), 'Tue, 25 Oct 2022 12:57:46 GMT');
  });

  it('test listVersions no versions', async () => {
    nock.source()
      .getObject('/my-org/my-site/abc/987.html/.versions/index.json')
      .reply(404);
    nock.source()
      .headObject('/my-org/my-site/abc/987.html')
      .reply(200, null, {
        'content-length': '327',
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });

    const info = createInfo('/my-org/sites/my-site/source/abc/987.html/.versions');
    const resp = await getVersions(createContext(), info);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-type'), 'application/json');
    assert.equal(resp.headers.get('content-length'), '2');
    assert.equal(await resp.text(), '[]');
  });

  it('test headVersions no versions', async () => {
    nock.source()
      .headObject('/my-org/my-site/abc/987.html/.versions/index.json')
      .reply(404);
    nock.source()
      .headObject('/my-org/my-site/abc/987.html')
      .reply(200, null, {
        'content-length': '327',
        'last-modified': 'Tue, 25 Oct 2022 02:57:46 GMT',
      });

    const info = createInfo('/my-org/sites/my-site/source/abc/987.html/.versions');
    const resp = await getVersions(createContext(), info, true);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-type'), 'application/json');
    assert.equal(resp.headers.get('content-length'), '2');
  });

  it('test listVersions no document', async () => {
    nock.source()
      .getObject('/my-org/my-site/abc/987.html/.versions/index.json')
      .reply(404);
    nock.source()
      .headObject('/my-org/my-site/abc/987.html')
      .reply(404);

    const info = createInfo('/my-org/sites/my-site/source/abc/987.html/.versions');
    const resp = await getVersions(createContext(), info);
    assert.equal(resp.status, 404);
  });

  it('test GET a version of a file', async () => {
    nock.source()
      .getObject('/my-org/my-site/abc/987.html/.versions/1')
      .reply(200, 'Hello, world!', {
        'content-type': 'text/plain',
        'last-modified': 'Tue, 25 Oct 2022 07:47:46 GMT',
      });

    const info = createInfo('/my-org/sites/my-site/source/abc/987.html/.versions/1');
    const resp = await getVersions(createContext(), info);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-length'), '13');
    assert.equal(resp.headers.get('content-type'), 'text/plain');
    assert.equal(await resp.text(), 'Hello, world!');
  });

  it('test HEAD a version of a file', async () => {
    nock.source()
      .headObject('/my-org/my-site/abc/987.html/.versions/1')
      .reply(200, 'Hello, world!', {
        'last-modified': 'Tue, 25 Oct 2022 07:47:46 GMT',
        'content-length': '698',
      });

    const info = createInfo('/my-org/sites/my-site/source/abc/987.html/.versions/1');
    const resp = await getVersions(createContext(), info, true);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-length'), '698');
  });

  it('test GET a version of a file causes error', async () => {
    nock.source()
      .getObject('/my-org/my-site/abc/987.html/.versions/1')
      .reply(400);

    const info = createInfo('/my-org/sites/my-site/source/abc/987.html/.versions/1');
    const resp = await getVersions(createContext(), info);
    assert.equal(resp.status, 400);
    assert(resp.headers.get('x-error').includes('Error'));
  });

  it('test GET a version of a file not found', async () => {
    nock.source()
      .getObject('/my-org/my-site/abc/987.html/.versions/1')
      .reply(404);

    const info = createInfo('/my-org/sites/my-site/source/abc/987.html/.versions/1');
    const resp = await getVersions(createContext(), info);
    assert.equal(resp.status, 404);
  });

  it('test GET unknown version subpath', async () => {
    const info = createInfo('/my-org/sites/my-site/source/abc/987.html/.versions/hello');
    const resp = await getVersions(createContext(), info);
    assert.equal(resp.status, 404);
  });

  it('test restore version', async () => {
    nock.source()
      .copyObject('/myorg/mysite/toast/jam.html')
      .matchHeader('x-amz-copy-source', 'helix-source-bus/myorg/mysite/toast/jam.html/.versions/68')
      .reply(200, new xml2js.Builder().buildObject({
        CopyObjectResult: {
          ETag: 'a25',
        },
      }));

    const path = '/myorg/sites/mysite/source/toast/jam.html';
    const context = setupContext(path, {
      data: {
        restore: 68,
      },
    });
    const info = createInfo(path);
    const baseKey = getS3KeyFromInfo(info);
    const resp = await postVersion(context, baseKey);
    assert.equal(resp.status, 200);
  });

  it('test restore version error', async () => {
    const path = '/myorg/sites/mysite/source/toast/jam.html';
    const context = setupContext(path, {
      data: {
        restore: 68,
      },
    });
    const info = createInfo(path);
    const baseKey = getS3KeyFromInfo(info);
    const resp = await postVersion(context, baseKey);
    assert.equal(resp.status, 500);
  });
});
