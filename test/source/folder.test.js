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
/* eslint-disable no-param-reassign */
import assert from 'assert';
import { getSource, headSource } from '../../src/source/get.js';
import { postSource } from '../../src/source/post.js';
import { createInfo, Nock } from '../utils.js';
import { setupContext } from './testutils.js';

const BUCKET_LIST_RESULT1 = `
  <ListBucketResult>
    <Name>my-bucket</Name>
    <Prefix>org1/site2/a/b/c/</Prefix>
    <Marker></Marker>
    <MaxKeys>1000</MaxKeys>
    <IsTruncated>false</IsTruncated>
    <Contents>
      <Key>org1/site2/a/b/c/somejson.json</Key>
      <LastModified>2025-01-01T12:34:56.000Z</LastModified>
      <Size>32768</Size>
    </Contents>
    <Contents>
      <Key>org1/site2/a/b/c/d1.html</Key>
      <LastModified>2021-12-31T01:01:01.001Z</LastModified>
      <Size>123</Size>
    </Contents>
    <Contents>
      <Key>org1/site2/a/b/c/someunknownfile</Key>
      <LastModified>2001-01-01T01:01:01.001Z</LastModified>
      <Size>88888</Size>
    </Contents>
    <Contents>
      <Key>org1/site2/a/b/c/mwahaha.mwa</Key>
      <LastModified>2025-01-01T12:34:56.000Z</LastModified>
      <Size>3141592653</Size>
    </Contents>
    <CommonPrefixes>
      <Prefix>org1/site2/a/b/c/q/</Prefix>
    </CommonPrefixes>
  </ListBucketResult>`;

const BUCKET_LIST_RESULT2 = `
  <ListBucketResult>
    <Name>my-bucket</Name>
    <Prefix>org1/site2/some/subfolder/</Prefix>
    <Marker></Marker>
    <MaxKeys>1000</MaxKeys>
    <IsTruncated>false</IsTruncated>
    <Contents>
      <Key>org1/site2/some/subfolder/.props</Key>
      <LastModified>2021-12-31T01:01:01.001Z</LastModified>
      <Size>3</Size>
    </Contents>
  </ListBucketResult>`;

describe('Source List Tests', () => {
  let context;
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    context = setupContext();
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('test GET folder', async () => {
    nock.source()
      .get('/?delimiter=%2F&list-type=2&prefix=org1%2Fsite2%2Fa%2Fb%2Fc%2F')
      .reply(200, Buffer.from(BUCKET_LIST_RESULT1));

    const info = createInfo('/org1/sites/site2/source/a/b/c/');
    const resp = await getSource(context, info);
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.deepStrictEqual(json, [
      {
        name: 'd1.html',
        size: 123,
        'content-type': 'text/html',
        'last-modified': '2021-12-31T01:01:01.001Z',
      },
      {
        name: 'q/',
        'content-type': 'application/folder',
      },
      {
        name: 'somejson.json',
        size: 32768,
        'content-type': 'application/json',
        'last-modified': '2025-01-01T12:34:56.000Z',
      },
    ]);
  });

  it('test HEAD folder', async () => {
    nock.source()
      .get('/?delimiter=%2F&list-type=2&prefix=org1%2Fsite2%2Fa%2Fb%2Fc%2F')
      .reply(200, Buffer.from(BUCKET_LIST_RESULT1));

    const info = createInfo('/org1/sites/site2/source/a/b/c/');
    const resp = await headSource(context, info);
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), '');
  });

  it('test GET folder with no contents', async () => {
    nock.source()
      .get('/?delimiter=%2F&list-type=2&prefix=org1%2Fsite2%2Fsome%2Fsubfolder%2F')
      .reply(200, Buffer.from(BUCKET_LIST_RESULT2));

    const info = createInfo('/org1/sites/site2/source/some/subfolder/');
    const resp = await getSource(context, info);
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.length, 0);
  });

  it('test HEAD folder with no contents', async () => {
    nock.source()
      .get('/?delimiter=%2F&list-type=2&prefix=org1%2Fsite2%2Fsome%2Fsubfolder%2F')
      .reply(200, Buffer.from(BUCKET_LIST_RESULT2));

    const info = createInfo('/org1/sites/site2/source/some/subfolder/');
    const resp = await headSource(context, info);
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), '');
  });

  it('test GET folder does not exist', async () => {
    nock.source()
      .get('/?delimiter=%2F&list-type=2&prefix=org1%2Fsite2%2Fbase%2Fsub%2F')
      .reply(200);

    const info = createInfo('/org1/sites/site2/source/base/sub/');
    const resp = await getSource(context, info);
    assert.equal(resp.status, 404);
  });

  it('test HEAD folder does not exist', async () => {
    nock.source()
      .get('/?delimiter=%2F&list-type=2&prefix=org1%2Fsite2%2Fbase%2Fsub%2F')
      .reply(200);

    const info = createInfo('/org1/sites/site2/source/base/sub/');
    const resp = await headSource(context, info);
    assert.equal(resp.status, 404);
  });

  it('test GET folder with error', async () => {
    nock.source()
      .get('/?delimiter=%2F&list-type=2&prefix=org1%2Fsite2%2Fa%2Fb%2Fc%2F')
      .replyWithError('Oh no!');

    const info = createInfo('/org1/sites/site2/source/a/b/c/');
    const resp = await getSource(context, info);
    assert.equal(resp.status, 500);
    assert.equal(resp.headers.get('x-error'), 'Oh no!');
  });

  it('test create folder', async () => {
    nock.source()
      .putObject('/org1/site2/new/.props')
      .reply(201);
    const info = createInfo('/org1/sites/site2/source/new/');
    const resp = await postSource(context, info);
    assert.equal(resp.status, 201);
  });

  it('test create folder with error', async () => {
    nock.source()
      .putObject('/org1/site2/new/.props')
      .reply(401);
    const info = createInfo('/org1/sites/site2/source/new/');
    const resp = await postSource(context, info);
    assert.equal(resp.status, 401);
  });
});
