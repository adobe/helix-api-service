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
import { Request, Response } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/auth-info.js';
import { HANDLERS } from '../../src/contentproxy/index.js';
import { main } from '../../src/index.js';
import { Nock, SITE_CONFIG, ORG_CONFIG } from '../utils.js';
import { REDIRECTS_JSON_PATH } from '../../src/contentbus/contentbus.js';

describe('Preview Action Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  /** @type {import('../../src/contentproxy/contentproxy').ContentSourceHandler} */
  let handler;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
    handler = HANDLERS.find((h) => h.name === SITE_CONFIG.content.source.type);

    nock.siteConfig(SITE_CONFIG);
    nock.orgConfig(ORG_CONFIG);
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  function setupTest(path = '/') {
    const suffix = `/org/sites/site/preview${path}`;

    const request = new Request(`https://localhost${suffix}`, {
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
        redirects: { preview: [] },
      },
      runtime: { region: 'us-east-1' },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
        HELIX_STORAGE_DISABLE_R2: 'true',
      },
    };
    return { request, context };
  }

  it('preview document', async () => {
    sandbox.stub(handler, 'handle')
      .returns(new Response(200, '# hello, world!'));

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
  });

  it('preview redirects', async () => {
    sandbox.stub(handler, 'handleJSON')
      .returns(new Response(200, {
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

  it('reports an error when `contentBusUpdate` returns 500', async () => {
    sandbox.stub(handler, 'handleJSON')
      .rejects(new Error());

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

    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to fetch '/redirects.json' from 'google': ",
      'x-error-code': 'AEM_BACKEND_FETCH_FAILED',
    });
  });
});
