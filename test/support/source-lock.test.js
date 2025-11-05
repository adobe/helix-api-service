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
import sourceLock from '../../src/support/source-lock.js';
import {
  Nock, SITE_CONFIG, createContext,
} from '../utils.js';

const SITE_1D_CONFIG = {
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'onedrive',
      url: 'https://adobe.sharepoint.com/sites/Site/Shared%20Documents/site',
    },
  },
};

describe('Source Lock Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  const suffix = '/owner/sites/repo/status/document';

  it('allows source if env is missing', async () => {
    assert.deepStrictEqual(await sourceLock.evaluate(createContext(suffix), 'org', 'site'), {
      allowed: true,
      reason: 'no lock config',
    });
  });

  it('allows source if env is corrupt', async () => {
    assert.deepStrictEqual(await sourceLock.evaluate(createContext(suffix, {
      env: {
        HLX_CONTENT_SOURCE_LOCK: 'foo',
      },
    }), 'org', 'site'), {
      allowed: true,
      reason: 'error evaluating tenant lock',
    });
  });

  it('allows source if not found in config', async () => {
    assert.deepStrictEqual(await sourceLock.evaluate(createContext(suffix, {
      env: {
        HLX_CONTENT_SOURCE_LOCK: '{}',
      },
    }), 'org', 'site'), {
      allowed: true,
      reason: 'no lock info for site',
    });
  });

  it('denies source if not found in config', async () => {
    assert.deepStrictEqual(await sourceLock.evaluate(createContext(suffix, {
      env: {
        HLX_CONTENT_SOURCE_LOCK: JSON.stringify({
          'adobe.sharepoint.com': [],
        }),
      },
      attributes: { config: SITE_1D_CONFIG },
    }), 'org', 'site'), {
      allowed: false,
      reason: 'access for org/site to adobe.sharepoint.com denied by tenant lock',
    });
  });

  it('allows source if found in config', async () => {
    assert.deepStrictEqual(await sourceLock.evaluate(createContext(suffix, {
      env: {
        HLX_CONTENT_SOURCE_LOCK: JSON.stringify({
          'adobe.sharepoint.com': ['org/site'],
        }),
      },
      attributes: { config: SITE_1D_CONFIG },
    }), 'org', 'site'), {
      allowed: true,
      reason: 'site allowed by lock',
    });
  });

  it('allows source if found in config by org global', async () => {
    assert.deepStrictEqual(await sourceLock.evaluate(createContext(suffix, {
      env: {
        HLX_CONTENT_SOURCE_LOCK: JSON.stringify({
          'adobe.sharepoint.com': ['org/*'],
        }),
      },
      attributes: { config: SITE_1D_CONFIG },
    }), 'org', 'site'), {
      allowed: true,
      reason: 'site allowed by lock',
    });
  });

  it('assertSourceLock rejects source if not found in config', async () => {
    await assert.rejects(sourceLock.assert(createContext(suffix, {
      env: {
        HLX_CONTENT_SOURCE_LOCK: JSON.stringify({
          'adobe.sharepoint.com': [],
        }),
      },
      attributes: { config: SITE_1D_CONFIG },
    }), 'org', 'site'), new Error('Access denied'));
  });
});
