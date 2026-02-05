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
import { AccessDeniedError } from '../../src/auth/AccessDeniedError.js';
import { AuthInfo } from '../../src/auth/auth-info.js';
import codeStatus from '../../src/codebus/status.js';
import { createPathInfo, DEFAULT_CONTEXT, Nock } from '../utils.js';

describe('Code Status Tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('code status returns 404 for missing resource', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .head('/owner/repo/main/icons/acrobat_reader.svg')
      .reply(404);

    const result = await codeStatus(DEFAULT_CONTEXT({
      attributes: {
        authInfo: AuthInfo.Admin(),
      },
    }), createPathInfo('/code/owner/repo/main/icons/acrobat_reader.svg'));
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
    });
  });

  it('code status needs code:read permission', async () => {
    await assert.rejects(codeStatus({
      log: console,
      attributes: {
        authInfo: new AuthInfo(),
      },
    }, {}), new AccessDeniedError('code:read'));
  });

  it('code status throws error for underlying error', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .head('/owner/repo/main/icons/logo.svg')
      .times(3)
      .reply(500, '', {
        'x-error': 'internal error',
      });

    await assert.rejects(codeStatus(DEFAULT_CONTEXT({
      attributes: {
        authInfo: AuthInfo.Admin(),
      },
    }), createPathInfo('/code/owner/repo/main/icons/logo.svg')), new Error('error while fetching: 500'));
  });

  it('returns code status for resource', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .head('/owner/repo/main/icons/logo.svg')
      .reply(200, '', {
        'content-type': 'text/xml+svg',
        'content-length': '123',
        'last-modified': 'Wed, 12 Oct 2009 17:50:00 GMT',
        'x-amz-meta-x-source-last-modified': 'Wed, 1 June 2009 17:50:00 GMT',
      });

    const result = await codeStatus(DEFAULT_CONTEXT({
      attributes: {
        authInfo: AuthInfo.Admin(),
      },
    }), createPathInfo('/code/owner/repo/main/icons/logo.svg'));

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
        permissions: ['delete', 'delete-forced', 'read', 'write'],
      },
      edit: {
        url: 'https://github.com/owner/repo/edit/main/icons/logo.svg',
      },
      links: {
        code: 'https://admin.hlx.page/code/owner/repo/main/icons/logo.svg',
        live: 'https://admin.hlx.page/live/owner/repo/main/icons/logo.svg',
        preview: 'https://admin.hlx.page/preview/owner/repo/main/icons/logo.svg',
        status: 'https://admin.hlx.page/status/owner/repo/main/icons/logo.svg',
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
      'content-type': 'application/json',
    });
  });

  it('returns code status for resource with uppercase ref', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .head('/owner/repo/issue-1234/icons/adobe_red.jpg')
      .reply(200, '', {
        'content-type': 'image/jpg',
        'last-modified': 'Wed, 12 Oct 2009 17:50:00 GMT',
      });

    const result = await codeStatus(DEFAULT_CONTEXT({
      attributes: {
        authInfo: AuthInfo.Admin(),
      },
    }), createPathInfo('/code/owner/repo/ISSUE-1234/icons/adobe_red.jpg'));

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      code: {
        codeBusId: 'helix-code-bus/owner/repo/issue-1234/icons/adobe_red.jpg',
        contentType: 'image/jpg',
        lastModified: 'Mon, 12 Oct 2009 17:50:00 GMT',
        permissions: [
          'delete',
          'delete-forced',
          'read',
          'write',
        ],
        sourceLocation: 'https://raw.githubusercontent.com/owner/repo/ISSUE-1234/icons/adobe_red.jpg',
        status: 200,
      },
      edit: {
        url: 'https://github.com/owner/repo/edit/ISSUE-1234/icons/adobe-red.jpg',
      },
      links: {
        code: 'https://admin.hlx.page/code/owner/repo/issue-1234/icons/adobe-red.jpg?branch=ISSUE-1234',
        live: 'https://admin.hlx.page/live/owner/repo/issue-1234/icons/adobe-red.jpg?branch=ISSUE-1234',
        preview: 'https://admin.hlx.page/preview/owner/repo/issue-1234/icons/adobe-red.jpg?branch=ISSUE-1234',
        status: 'https://admin.hlx.page/status/owner/repo/issue-1234/icons/adobe-red.jpg?branch=ISSUE-1234',
      },
      live: {
        url: 'https://issue-1234--repo--owner.aem.live/icons/adobe-red.jpg',
      },
      preview: {
        url: 'https://issue-1234--repo--owner.aem.page/icons/adobe-red.jpg',
      },
      resourcePath: '/icons/adobe-red.jpg',
      webPath: '/icons/adobe-red.jpg',
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
    });
  });
});
