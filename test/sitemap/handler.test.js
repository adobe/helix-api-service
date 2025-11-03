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
import sinon from 'sinon';
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import purge from '../../src/cache/purge.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';

describe('Cache Handler Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  const suffix = '/org/sites/site/sitemap/sitemap.xml';

  it('sends method not allowed for unsupported method', async () => {
    const result = await main(new Request(`https://api.aem.live${suffix}`), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });

    assert.strictEqual(result.status, 405);
    assert.strictEqual(await result.text(), 'method not allowed');
    assert.deepStrictEqual(result.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
    });
  });

  it('rebuild sitemap purges the cache', async () => {
    const purges = [];
    sandbox.stub(purge, 'content').callsFake((context, info, paths) => {
      purges.push(...paths);
      return new Response('', {
        status: 200,
      });
    });

    nock.sitemapConfig(null);
    nock.content()
      .head('/live/sitemap.json')
      .reply(200)
      .getObject('/live/sitemap.json')
      .reply(200, {
        data: [{ path: '/page', lastModified: 1631031300 }],
      })
      .getObject('/live/sitemap.xml')
      .reply(404)
      .putObject('/live/sitemap.xml')
      .reply(200)
      .putObject('/preview/sitemap.xml')
      .reply(200);

    const result = await main(new Request(`https://api.aem.live${suffix}`, {
      method: 'POST',
    }), {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
      },
    });

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(await result.json(), {
      paths: ['/sitemap.xml'],
    });
    assert.deepStrictEqual(purges, ['/sitemap.xml']);
  });
});
