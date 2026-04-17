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
import { getS3Key, getS3KeyFromInfo, getDocPathFromS3Key } from '../../src/source/s3-path-utils.js';

describe('S3 Path Utils Tests', () => {
  it('test getS3Key', () => {
    assert.equal(getS3Key('org1', 'site2', '/a/b/c/'), 'org1/site2/a/b/c/');
  });

  it('test getS3Key with file path', () => {
    assert.equal(getS3Key('myorg', 'mysite', '/doc.html'), 'myorg/mysite/doc.html');
  });

  it('test getS3KeyFromInfo', () => {
    const info = { org: 'org1', site: 'site2', resourcePath: '/a/b/c.html' };
    assert.equal(getS3KeyFromInfo(info), 'org1/site2/a/b/c.html');
  });

  it('test getDocPathFromS3Key', () => {
    assert.equal(getDocPathFromS3Key('org1/site2/a/b/c.html'), '/a/b/c.html');
  });

  it('test getDocPathFromS3Key with folder', () => {
    assert.equal(getDocPathFromS3Key('org1/site2/a/b/c/'), '/a/b/c/');
  });

  it('test getDocPathFromS3Key with root file', () => {
    assert.equal(getDocPathFromS3Key('org1/site2/doc.html'), '/doc.html');
  });
});
