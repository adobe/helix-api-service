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
import { getSource } from '../../src/source/get.js';
import { createContext, createInfo, Nock } from '../utils.js';

describe('Source List Tests', () => {
  let context;
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    context = createContext();
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('test GET folder', async () => {
    const bucketListResult = `
      <ListBucketResult>
        <Name>my-bucket</Name>
        <Prefix>org1/site2/a/b/c/</Prefix>
        <Marker></Marker>
        <MaxKeys>1000</MaxKeys>
        <IsTruncated>false</IsTruncated>
        <Contents>
          <Key>org1/site2/a/b/c/d1.html</Key>
          <LastModified>2021-12-31T01:01:01.001Z</LastModified>
          <Size>123</Size>
        </Contents>
        <Contents>
          <Key>org1/site2/a/b/c/somepdf.pdf</Key>
          <LastModified>2025-01-01T12:34:56.000Z</LastModified>
          <Size>32768</Size>
        </Contents>
        <CommonPrefixes>
          <Prefix>org1/site2/a/b/c/</Prefix>
        </CommonPrefixes>
      </ListBucketResult>`;

    nock.source()
      .get('/?delimiter=%2F&list-type=2&prefix=org1%2Fsite2%2Fa%2Fb%2Fc%2F')
      .reply(200, Buffer.from(bucketListResult));

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
        name: 'somepdf.pdf',
        size: 32768,
        'content-type': 'application/pdf',
        'last-modified': '2025-01-01T12:34:56.000Z',
      },
    ]);
  });
});
