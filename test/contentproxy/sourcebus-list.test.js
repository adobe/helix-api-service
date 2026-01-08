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
import { resolve } from 'path';
import { readFile } from 'fs/promises';
import { list } from '../../src/contentproxy/sourcebus-list.js';
import {
  Nock, SITE_CONFIG, createContext, createInfo,
} from '../utils.js';
import { StatusCodeError } from '../../src/support/StatusCodeError.js';

const SITE_MUP_CONFIG = (url = 'https://api.aem.live/org/sites/site/source') => ({
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'markup',
      url,
    },
  },
});

function specPath(spec) {
  return resolve(__testdir, 'contentproxy', 'fixtures', spec);
}

describe('Source Bus Content Proxy Tests (list)', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(suffix = '/org/sites/site/contentproxy/', {
    config = SITE_MUP_CONFIG(),
  } = {}) {
    const context = createContext(suffix, {
      attributes: { config },
    });
    const info = createInfo(suffix, {
      'x-workbook-session-id': 'test-session-id',
    }).withCode('owner', 'repo');
    return { context, info };
  }

  it('Retrieves tree list from sourcebus', async () => {
    nock.source()
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'org/site/documents',
      })
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/list-documents.xml'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/xml',
      })
      .get('/')
      .query({
        'list-type': '2',
        prefix: 'org/site/blog',
      })
      .reply(500);

    const { context, info } = setupTest();
    const result = await list(context, info, [
      '/documents/*',
      '/blog/post1',
    ]);

    assert.deepStrictEqual(result, JSON.parse(await readFile(specPath('sourcebus/list-documents-result.json'))));
  });

  it('Rejects list if source.url has the correct format', async () => {
    const { context, info } = setupTest(undefined, {
      config: {
        ...SITE_MUP_CONFIG('https://api.aem.live/org/sites/status'),
      },
    });
    await assert.rejects(list(context, info, ['/documents/*']), new StatusCodeError('Source url must be in the format: https://api.aem.live/<org>/sites/<site>/source. Got: https://api.aem.live/org/sites/status', 400));
  });
  it('Rejects list if source.url is on wrong org/site', async () => {
    const { context, info } = setupTest('/org/sites/othersite/contentproxy/', {
      config: {
        ...SITE_MUP_CONFIG('https://api.aem.live/org/sites/site/source'),
      },
    });
    await assert.rejects(list(context, info, ['/documents/*']), new StatusCodeError('Source bus is not allowed for org: org, site: othersite', 400));
  });
});
