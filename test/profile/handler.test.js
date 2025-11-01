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
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import assert from 'assert';
import { Request } from '@adobe/fetch';
import idpAdmin from '../../src/idp-configs/admin.js';
import idpFakeTestIDP from '../idp-configs/test-idp.js';
import { main } from '../../src/index.js';
import { Nock } from '../utils.js';

describe('Profile Handler Tests', async () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;
  let privateKey;

  before(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey;
    // privateJwk = await exportJWK(privateKey);
    const publicJwk = await exportJWK(keyPair.publicKey);
    idpAdmin.discovery.jwks = {
      keys: [
        publicJwk,
      ],
    };
    idpFakeTestIDP.discovery.jwks = {
      keys: [
        publicJwk,
      ],
    };
  });

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('sends method not allowed for unsupported method', async () => {
    const result = await main(new Request('https://api.aem.live/', {
      method: 'PUT',
    }), {
      pathInfo: {
        suffix: '/profile',
      },
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'method not allowed');
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('sends 401 for unauthenticated requests (admin)', async () => {
    const result = await main(new Request('https://api.aem.live/', {
      method: 'GET',
    }), {
      func: {
        package: 'pkg',
        func: 'admin',
        version: '1.0',
      },
      pathInfo: {
        suffix: '/profile',
      },
    });
    assert.strictEqual(result.status, 401);
    assert.deepStrictEqual(await result.json(), {
      error: 'unauthorized',
      links: {
        login: 'https://api.aem.live/login',
      },
      status: 401,
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'x-error': 'not authenticated.',
      'cache-control': 'no-store, private, must-revalidate',
    });
  });

  it('displays profile', async () => {
    const authToken = await new SignJWT({
      email: 'test@example.com',
      name: 'Test User',
      userId: '112233',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer('https://admin.hlx.page/')
      .setSubject('*/*')
      .setAudience('dummy-clientid')
      .setExpirationTime('2h')
      .sign(privateKey);

    const result = await main(new Request('https://api.aem.live/', {
      method: 'GET',
      headers: {
        'x-forwarded-host': 'api.aem.live',
        host: 'myapi.execute-api.us-east-1.amazonaws.com',
        cookie: `auth_token=${authToken}`,
      },
    }), {
      pathInfo: {
        suffix: '/profile',
      },
    });
    assert.strictEqual(result.status, 200);
    const body = await result.json();
    delete body.profile.exp;
    delete body.profile.iat;
    assert.ok(Math.abs(body.profile.ttl - 7200) < 2);
    delete body.profile.ttl;
    assert.deepStrictEqual(body, {
      profile: {
        aud: 'dummy-clientid',
        iss: 'https://admin.hlx.page/',
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      },
      links: {
        logout: 'https://api.aem.live/logout',
      },
      status: 200,
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('displays profile (with token)', async () => {
    const authToken = await new SignJWT({
      email: 'test@example.com',
      name: 'Test User',
      userId: '112233',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer('https://admin.hlx.page/')
      .setSubject('*/*')
      .setAudience('dummy-clientid')
      .setExpirationTime('2h')
      .sign(privateKey);

    const result = await main(new Request('https://api.aem.live/', {
      method: 'GET',
      headers: {
        'x-forwarded-host': 'api.aem.live',
        host: 'myapi.execute-api.us-east-1.amazonaws.com',
        cookie: `auth_token=${authToken}`,
      },
    }), {
      pathInfo: {
        suffix: '/profile',
      },
    });
    assert.strictEqual(result.status, 200);
    const body = await result.json();
    delete body.profile.exp;
    delete body.profile.iat;
    assert.ok(Math.abs(body.profile.ttl - 7200) < 2);
    delete body.profile.ttl;
    assert.deepStrictEqual(body, {
      profile: {
        aud: 'dummy-clientid',
        iss: 'https://admin.hlx.page/',
        email: 'test@example.com',
        name: 'Test User',
        userId: '112233',
      },
      links: {
        logout: 'https://api.aem.live/logout',
      },
      status: 200,
    });
    assert.deepStrictEqual(result.headers.plain(), {
      'content-type': 'application/json',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });
});
