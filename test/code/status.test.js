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
import { Request } from '@adobe/fetch';
import { AccessDeniedError } from '../../src/auth/AccessDeniedError.js';
import { AuthInfo } from '../../src/auth/auth-info.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';
import { status } from '../../src/code/status.js';
import { main } from '../../src/index.js';

function setupTest(path = '/', { data } = {}) {
  const suffix = `/owner/repos/repo/code${path}`;
  const query = new URLSearchParams(data);

  const request = new Request(`https://api.aem.live${suffix}?${query}`, {
    headers: {
      'x-request-id': 'rid',
      'content-type': data ? 'application/json' : 'text/plain',
    },
  });
  const context = {
    pathInfo: { suffix },
    attributes: {
      authInfo: AuthInfo.Default().withAuthenticated(true),
      infoMarkerChecked: true,
    },
    runtime: { region: 'us-east-1' },
    env: {
      HLX_CONFIG_SERVICE_TOKEN: 'token',
      HLX_FASTLY_PURGE_TOKEN: 'token',
      HELIX_STORAGE_DISABLE_R2: 'true',
      HELIX_STORAGE_MAX_ATTEMPTS: '1',
    },
  };
  return { request, context };
}

describe('Code Status Tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('code status needs code:read permission', async () => {
    await assert.rejects(status({
      log: console,
      attributes: {
        authInfo: new AuthInfo(),
      },
    }, {}), new AccessDeniedError('code:read'));
  });

  it('code status throws error for underlying error', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .head('/owner/repo/main/icons/logo.svg')
      .reply(500, '', {
        'x-error': 'internal error',
      });

    await assert.rejects(status(createContext({
      attributes: {
        authInfo: AuthInfo.Admin(),
      },
    }), createInfo('/owner/repos/repo/code/main/icons/logo.svg')
      .withCode('owner', 'repo')), new Error('error while fetching: 500'));
  });

  it('code status returns 404 for missing resource', async () => {
    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .head('/owner/repo/main/icons/acrobat_reader.svg')
      .reply(404);

    const { request, context } = await setupTest('/main/icons/acrobat_reader.svg');
    const result = await main(request, context);
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      vary: 'Accept-Encoding',
    });
  });

  it('returns code status for resource', async () => {
    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .head('/owner/repo/main/icons/logo.svg')
      .reply(200, '', {
        'content-type': 'text/xml+svg',
        'content-length': '123',
        'last-modified': 'Wed, 12 Oct 2009 17:50:00 GMT',
        'x-amz-meta-x-source-last-modified': 'Wed, 1 June 2009 17:50:00 GMT',
      });

    const { request, context } = await setupTest('/main/icons/logo.svg');
    const result = await main(request, context);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      code: {
        codeBusId: 'helix-code-bus/owner/repo/main/icons/logo.svg',
        contentLength: '123',
        contentType: 'text/xml+svg',
        lastModified: 'Mon, 12 Oct 2009 17:50:00 GMT',
        sourceLastModified: 'Wed, 1 June 2009 17:50:00 GMT',
        sourceLocation: 'https://raw.githubusercontent.com/owner/repo/main/icons/logo.svg',
        status: 200,
        permissions: ['delete', 'read', 'write'],
      },
      edit: {
        url: 'https://github.com/owner/repo/edit/main/icons/logo.svg',
      },
      links: {
        code: 'https://api.aem.live/owner/repos/repo/code/main/icons/logo.svg',
        live: 'https://api.aem.live/owner/sites/repo/live/icons/logo.svg',
        preview: 'https://api.aem.live/owner/sites/repo/preview/icons/logo.svg',
        status: 'https://api.aem.live/owner/sites/repo/status/icons/logo.svg',
      },
      live: {
        url: 'https://main--repo--owner.aem.live/icons/logo.svg',
      },
      preview: {
        url: 'https://main--repo--owner.aem.page/icons/logo.svg',
      },
      resourcePath: '/icons/logo.svg',
      webPath: '/icons/logo.svg',
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'application/json',
      vary: 'Accept-Encoding',
    });
  });

  it('returns code status for resource with branch', async () => {
    nock.siteConfig(SITE_CONFIG, { org: 'owner', site: 'repo' });
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .head('/owner/repo/issue-42/icons/logo.svg')
      .reply(200, '', {
        'content-type': 'text/xml+svg',
        'content-length': '123',
        'last-modified': 'Wed, 12 Oct 2009 17:50:00 GMT',
        'x-amz-meta-x-source-last-modified': 'Wed, 1 June 2009 17:50:00 GMT',
      });

    const { request, context } = setupTest('/issue-42/icons/logo.svg', { data: { branch: 'ISSUE/42' } });
    const result = await main(request, context);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      code: {
        codeBusId: 'helix-code-bus/owner/repo/issue-42/icons/logo.svg',
        contentLength: '123',
        contentType: 'text/xml+svg',
        lastModified: 'Mon, 12 Oct 2009 17:50:00 GMT',
        sourceLastModified: 'Wed, 1 June 2009 17:50:00 GMT',
        sourceLocation: 'https://raw.githubusercontent.com/owner/repo/issue-42/icons/logo.svg',
        status: 200,
        permissions: ['delete', 'read', 'write'],
      },
      edit: {
        url: 'https://github.com/owner/repo/edit/ISSUE/42/icons/logo.svg',
      },
      links: {
        code: 'https://api.aem.live/owner/repos/repo/code/issue-42/icons/logo.svg',
        live: 'https://api.aem.live/owner/sites/repo/live/icons/logo.svg',
        preview: 'https://api.aem.live/owner/sites/repo/preview/icons/logo.svg',
        status: 'https://api.aem.live/owner/sites/repo/status/icons/logo.svg',
      },
      live: {
        url: 'https://issue-42--repo--owner.aem.live/icons/logo.svg',
      },
      preview: {
        url: 'https://issue-42--repo--owner.aem.page/icons/logo.svg',
      },
      resourcePath: '/icons/logo.svg',
      webPath: '/icons/logo.svg',
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'application/json',
      vary: 'Accept-Encoding',
    });
  });
});
