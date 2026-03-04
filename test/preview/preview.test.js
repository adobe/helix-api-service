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
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import sinon from 'sinon';
import { Request, Response } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { HANDLERS } from '../../src/contentproxy/index.js';
import { main } from '../../src/index.js';
import purge from '../../src/cache/purge.js';
import { METADATA_JSON_PATH, REDIRECTS_JSON_PATH } from '../../src/contentbus/contentbus.js';
import { Nock, SITE_CONFIG } from '../utils.js';

describe('Preview Action Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  /** @type {import('../../src/contentproxy/contentproxy').ContentSourceHandler} */
  let contentproxy;

  /** @type {string[]} */
  let surrogates;

  /** @type {import('../../src/cache/purge.js').PurgeInfo[]} */
  let purgeInfos;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
    contentproxy = HANDLERS[SITE_CONFIG.content.source.type];

    sandbox.stub(purge, 'perform').callsFake((context, info, infos) => {
      purgeInfos = infos;
    });
    sandbox.stub(purge, 'surrogate').callsFake((context, info, keys) => {
      surrogates = keys;
    });

    nock.siteConfig(SITE_CONFIG);
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  function setupTest(path = '/', { data, redirects } = {}) {
    const suffix = `/org/sites/site/preview${path}`;
    const query = new URLSearchParams(data);

    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      method: 'POST',
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo: AuthInfo.Default().withAuthenticated(true),
        googleApiOpts: { retry: false },
        infoMarkerChecked: true,
        redirects: { preview: redirects ?? [] },
      },
      runtime: { region: 'us-east-1' },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
        HLX_FASTLY_PURGE_TOKEN: 'token',
        HELIX_STORAGE_DISABLE_R2: 'true',
      },
    };
    return { request, context };
  }

  it('preview document', async () => {
    sandbox.stub(contentproxy, 'handle')
      .returns(new Response('# hello, world!'));

    nock.content()
      .head('/preview/index.md')
      .reply(404)
      .putObject('/preview/index.md')
      .reply(201)
      .head('/preview/index.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(purgeInfos, [
      { path: '/' },
      { path: '/index.plain.html' },
      { key: 'p_DiyvKbkf2MaZORJJ' },
      { key: '8lnjgOWBwsoqAQXB' },
    ]);
  });

  it('reports an error when `contentBusUpdate` returns 404 and no redirect matches', async () => {
    sandbox.stub(contentproxy, 'handle')
      .returns(new Response('', { status: 404 }));

    const { request, context } = setupTest('/');
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
    });
  });

  it('tweaks status when `contentBusUpdate` returns 404 and a redirect matches', async () => {
    sandbox.stub(contentproxy, 'handle')
      .returns(new Response('', { status: 404 }));

    nock.content()
      .head('/preview/index.md')
      .reply(404)
      .putObject('/preview/index.md')
      .reply(201, function fn(uri, body) {
        assert.strictEqual(this.req.headers['x-amz-meta-redirect-location'], '/target');
        assert.strictEqual(body, '/target');
      })
      .head('/preview/index.md')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const { request, context } = setupTest('/', {
      redirects: {
        '/index.md': '/target',
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), {
      links: {
        code: 'https://api.aem.live/org/repos/site/code/main/',
        live: 'https://api.aem.live/org/sites/site/live/',
        preview: 'https://api.aem.live/org/sites/site/preview/',
        status: 'https://api.aem.live/org/sites/site/status/',
      },
      preview: {
        configRedirectLocation: '/target',
        contentBusId: `helix-content-bus/${SITE_CONFIG.content.contentBusId}/preview/index.md`,
        contentType: 'text/plain; charset=utf-8',
        lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
        permissions: [
          'delete', 'read', 'write',
        ],
        sourceLocation: 'google:*',
        status: 200,
        url: 'https://main--site--org.aem.page/',
      },
      resourcePath: '/index.md',
      webPath: '/',
    });
  });

  it('preview redirects', async () => {
    sandbox.stub(contentproxy, 'handleJSON')
      .returns(new Response({
        default: {
          data: {
            source: '/from',
            destination: '/to',
          },
        },
      }));

    nock.content()
      .head('/preview/redirects.json')
      .reply(404)
      .getObject('/preview/redirects.json')
      .reply(404)
      .putObject('/preview/redirects.json')
      .reply(201)
      .head('/preview/redirects.json')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const { request, context } = setupTest(REDIRECTS_JSON_PATH);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
  });

  it('preview redirects with forced update', async () => {
    sandbox.stub(contentproxy, 'handleJSON')
      .returns(new Response({
        default: {
          data: {
            source: '/from',
            destination: '/to',
          },
        },
      }));

    nock.content()
      .head('/preview/redirects.json')
      .reply(404)
      .putObject('/preview/redirects.json')
      .reply(201)
      .head('/preview/redirects.json')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const { request, context } = setupTest(REDIRECTS_JSON_PATH, {
      data: {
        forceUpdateRedirects: true,
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
  });

  it('preview metadata', async () => {
    sandbox.stub(contentproxy, 'handleJSON')
      .returns(new Response({
        default: {
          data: {
            URL: '/**',
            Template: '/docs',
          },
        },
      }));

    nock.content()
      .head('/preview/metadata.json')
      .reply(404)
      .putObject('/preview/metadata.json')
      .reply(201)
      .head('/preview/metadata.json')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const { request, context } = setupTest(METADATA_JSON_PATH);
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(surrogates, ['U_NW4adJU7Qazf-I']);
  });

  it('reports an error when `contentBusUpdate` returns 500', async () => {
    sandbox.stub(contentproxy, 'handleJSON')
      .rejects(new Error());

    nock.content()
      .getObject('/preview/redirects.json')
      .reply(404);

    const { request, context } = setupTest(REDIRECTS_JSON_PATH);
    const response = await main(request, context);

    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to fetch '/redirects.json' from 'google': ",
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
    });
  });

  it('preview media', async () => {
    const png = await readFile(resolve(__testdir, 'contentproxy/fixtures/image.png'));
    const hash = '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc';

    sandbox.stub(contentproxy, 'handleFile')
      .returns(new Response(png, {
        headers: {
          'content-type': 'image/png',
        },
      }));

    nock.media()
      .putObject(`/${hash}`)
      .reply(201);
    nock.content()
      .putObject('/preview/image.png')
      .reply(201, function fn() {
        assert.strictEqual(this.req.headers['x-amz-meta-redirect-location'], `/media_${hash}.png`);
      })
      .head('/preview/image.png')
      .reply(200, '', { 'last-modified': 'Thu, 08 Jul 2021 10:04:16 GMT' });

    const { request, context } = setupTest('/image.png');
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(purgeInfos, [
      { path: '/image.png' },
      { key: 'p_K79E0Vf7_vRXHAKZ' },
      { key: 'dEpW7v-nLTvPjOcy' },
    ]);
  });
});
