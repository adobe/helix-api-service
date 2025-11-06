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
    nock.google(SITE_CONFIG.content)
      .user()
      .documents([{
        mimeType: 'application/vnd.google-apps.document',
        name: 'index',
        id: '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
      }]);
    nock('https://lambda.us-east-1.amazonaws.com')
      .post('/2015-03-31/functions/helix3--gdocs2md%3Av7/invocations')
      .reply(200, JSON.stringify({
        statusCode: 200,
        headers: {
          'x-source-location': '1jXZBaOHP9x9-2NiYPbeyiWOHbmDRKobIeb11JdCVyUw',
        },
        body: '# hello, world!',
      }));
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
    const google = HANDLERS.find((h) => h.name === 'google');
    sandbox.stub(google, 'handleJSON').callsFake(() => new Response(200, {
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
});
