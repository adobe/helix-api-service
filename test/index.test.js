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
import { Request } from '@adobe/fetch';
import { main } from '../src/index.js';
import { Nock, ORG_CONFIG, SITE_CONFIG } from './utils.js';

describe('Index Tests', () => {
  let nock;

  beforeEach(() => {
    nock = new Nock();
  });

  afterEach(() => {
    nock.done();
  });

  it('succeeds calling login handler', async () => {
    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/login',
      },
      env: {},
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), '');
  });

  it('fails calling login handler with suffix', async () => {
    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/login/path',
      },
      env: {},
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling code handler', async () => {
    nock.siteConfig().reply(200, SITE_CONFIG);
    nock.orgConfig().reply(200, ORG_CONFIG);

    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/owner/sites/repo/code/main',
      },
      env: {},
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling code handler with trailing path', async () => {
    nock.siteConfig().reply(200, SITE_CONFIG);
    nock.orgConfig().reply(200, ORG_CONFIG);

    const result = await main(new Request('https://localhost/', {
      headers: {
        'x-github-token': 'token',
        'x-github-base': 'https://my.github.com',
      },
    }), {
      log: console,
      pathInfo: {
        suffix: '/owner/sites/repo/code/main/src/scripts.js',
      },
      env: {},
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), '');
  });

  it('fails calling code handler with incomplete match', async () => {
    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/owner/sites/repo/code',
      },
      env: {},
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling status handler with trailing path', async () => {
    nock.siteConfig().reply(200, SITE_CONFIG);
    nock.orgConfig().reply(200, ORG_CONFIG);

    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/owner/sites/repo/status/document',
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      resourcePath: '/document.md',
      webPath: '/document',
    });
  });

  it('fails calling status handler with forbidden method', async () => {
    nock.siteConfig().reply(200, SITE_CONFIG);
    nock.orgConfig().reply(200, ORG_CONFIG);

    const result = await main(new Request('https://localhost/', { method: 'PUT' }), {
      log: console,
      pathInfo: {
        suffix: '/owner/sites/repo/status/document',
      },
      env: {},
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'method not allowed');
  });

  it('fails calling status handler with missing site config', async () => {
    nock.siteConfig().reply(404);

    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/owner/sites/repo/status/document',
      },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
      },
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });

  it('succeeds calling profiles handler', async () => {
    nock.orgConfig().reply(200, ORG_CONFIG);

    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/owner/profiles',
      },
      env: {},
    });
    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), '');
  });

  it('fails calling profiles handler with missing org', async () => {
    nock.orgConfig().reply(404);

    const result = await main(new Request('https://localhost/'), {
      log: console,
      pathInfo: {
        suffix: '/owner/profiles',
      },
      env: {},
    });
    assert.strictEqual(result.status, 404);
    assert.strictEqual(await result.text(), '');
  });
});
