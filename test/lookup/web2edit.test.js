/*
 * Copyright 2025 Adobe. All rights reserved.
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
import assert from 'assert';
import sinon from 'sinon';
import { Request } from '@adobe/fetch';
import { router } from '../../src/index.js';
import { Nock, SITE_CONFIG } from '../utils.js';
import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { AdminContext } from '../../src/support/AdminContext.js';
import { RequestInfo } from '../../src/support/RequestInfo.js';
import { lookup } from '../../src/lookup/web2edit.js';

describe('web2edit Tests', () => {
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  function createContext(suffix, editUrl, attributes = {}) {
    return new AdminContext({
      log: console,
      pathInfo: { suffix },
      data: { editUrl },
    }, { attributes });
  }

  function createInfo(suffix) {
    return RequestInfo.create(new Request('http://localhost/'), router.match(suffix).variables);
  }

  it('returns error when no handler is matching', async () => {
    const suffix = '/owner/sites/repo/status/page';

    const result = await lookup(
      createContext(suffix, 'auto', {
        authInfo: AuthInfo.Admin(),
        config: SITE_CONFIG,
        redirects: { preview: [], live: [] },
      }),
      createInfo(suffix),
      {
        contentBusId: SITE_CONFIG.content.contentBusId,
        source: {
          type: 'other',
        },
      },
    );
    assert.deepStrictEqual(result, {
      error: 'No handler found for document hlx:/owner/repo/page.',
      status: 404,
    });
  });
});
