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
import { GoogleClient } from '@adobe/helix-google-support';
import assert from 'assert';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { list } from '../../src/contentproxy/google-list.js';
import {
  Nock, SITE_CONFIG, createContext, createInfo,
} from '../utils.js';

function specPath(spec) {
  return resolve(__testdir, 'contentproxy', 'fixtures', spec);
}

describe('Google Integration Tests (list)', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
    GoogleClient.setItemCacheOptions({ max: 1000 });
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/') {
    const suffix = `/org/sites/site/contentproxy${path}`;

    const context = createContext(suffix);
    const info = createInfo(suffix).withCode('owner', 'repo');
    return { context, info };
  }

  it('Retrieves tree list from google drive', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .folders([{
        mimeType: 'application/vnd.google-apps.folder',
        name: 'documents',
        id: 'documents-id',
      }]);

    const DEFAULT_LIST_OPTS = {
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
      pageSize: 1000,
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    };

    // TODO: not possible with google nock
    nock('https://www.googleapis.com')
      .get('/drive/v3/files')
      .query({ q: "'documents-id' in parents and trashed=false", ...DEFAULT_LIST_OPTS })
      .replyWithFile(200, specPath('google-list-documents.json'), {
        'content-type': 'application/json',
      })
      .get('/drive/v3/files')
      .query({ q: "'folder-id' in parents and trashed=false", ...DEFAULT_LIST_OPTS })
      .replyWithFile(200, specPath('google-list-folder.json'), {
        'content-type': 'application/json',
      })
      .get('/drive/v3/files')
      .query({ q: "'folder-id' in parents and trashed=false", ...DEFAULT_LIST_OPTS, pageToken: 1234 })
      .replyWithFile(200, specPath('google-list-folder-next.json'), {
        'content-type': 'application/json',
      })
      .get('/drive/v3/files')
      .query({ q: "'sub-id' in parents and trashed=false", ...DEFAULT_LIST_OPTS })
      .replyWithFile(200, specPath('google-list-sub.json'), {
        'content-type': 'application/json',
      });

    const { context } = setupTest('/');
    const result = await list(context, ['/documents/*', '/documents/not-found']);

    assert.deepStrictEqual(result, JSON.parse(await readFile(specPath('google-list-result.json'))));
  });

  it('handles not found root item', async () => {
    nock.google(SITE_CONFIG.content)
      .user()
      .folders([]);

    const { context } = setupTest('/');
    const result = await list(context, ['/documents/*']);

    assert.deepStrictEqual(result, []);
  });
});
