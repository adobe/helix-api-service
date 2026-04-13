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
import { resolve } from 'path';
import assert from 'assert';
import { Request } from '@adobe/fetch';
import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { main } from '../../src/index.js';
import { createContext, Nock, SITE_CONFIG } from '../utils.js';
import { SVGValidationError, validateSVG } from '../../src/contentproxy/source/sourcebus.js';

const SITE_MUP_CONFIG = (url = 'https://api.aem.live/org/sites/site/source') => ({
  ...SITE_CONFIG,
  content: {
    ...SITE_CONFIG.content,
    source: {
      type: 'markup',
      url,
    },
  },
});

describe('Source Bus Content Proxy Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env({
      HELIX_STORAGE_DISABLE_R2: 'true',
    });
  });

  afterEach(() => {
    nock.done();
  });

  function setupTest(path = '/', {
    config = SITE_MUP_CONFIG(), data,
    authInfo = AuthInfo.Default().withAuthenticated(true),
  } = {}) {
    nock.siteConfig(config);

    const suffix = `/org/sites/site/contentproxy${path}`;
    const query = new URLSearchParams(data);

    const request = new Request(`https://api.aem.live${suffix}?${query}`, {
      headers: {
        'x-request-id': 'rid',
      },
    });
    const context = {
      pathInfo: { suffix },
      attributes: {
        authInfo,
        maxAttempts: 1,
      },
      runtime: { region: 'us-east-1' },
      env: {
        HLX_CONFIG_SERVICE_TOKEN: 'token',
        MEDIAHANDLER_NOCACHE: 'true',
      },
    };
    return { request, context };
  }

  it('Retrieves root document from source bus', async () => {
    nock.source()
      .getObject('/org/site/index.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/index.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });

    const { request, context } = setupTest('/', {
      config: {
        ...SITE_MUP_CONFIG(),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# Hello, world.\n\nTesting, source bus.\n');
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/markdown',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
      'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
    });
  });

  it('Retrieves document from source bus', async () => {
    nock.source()
      .getObject('/org/site/welcome.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/welcome.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });

    const { request, context } = setupTest('/welcome', {
      config: {
        ...SITE_MUP_CONFIG(),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '# Hello, world.\n\nTesting, source bus.\n');
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/markdown',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
      'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
    });
  });

  it('Returns 404 if resource is not found in source bus', async () => {
    nock.source()
      .getObject('/org/site/missing.html')
      .reply(404);

    const { request, context } = setupTest('/missing', {
      config: {
        ...SITE_MUP_CONFIG(),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
    });
  });

  it('Rejects preview if source.url has the correct format', async () => {
    const { request, context } = setupTest('/', {
      config: {
        ...SITE_MUP_CONFIG('https://api.aem.live/org/sites/status'),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'Source url must be in the format: https://api.aem.live/<org>/sites/<site>/source. Got: https://api.aem.live/org/sites/status',
    });
  });

  it('Rejects preview if not the same org/site', async () => {
    const { request, context } = setupTest('/', {
      config: {
        ...SITE_MUP_CONFIG('https://api.aem.live/org/sites/another/source'),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': 'Source bus is not allowed for org: org, site: site',
    });
  });

  it('Retrieves document from source bus with external images', async () => {
    nock.source()
      .getObject('/org/site/gallery.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/gallery.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });
    nock('https://www.example.com')
      .get('/image1.jpg')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/300.png'))
      .get('/image2.jpg')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/300.png'));
    nock.media()
      .head('/1c2e2c6c049ccf4b583431e14919687f3a39cc227')
      .times(2)
      .reply(404)
      .putObject('/1c2e2c6c049ccf4b583431e14919687f3a39cc227')
      .times(2)
      .reply(201);

    const { request, context } = setupTest('/gallery', {
      config: {
        ...SITE_MUP_CONFIG(),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), `# Hello, world.

source bus images.

![][image0] ![][image0] ![][image1]

[image0]: https://main--site--org.aem.page/media_1c2e2c6c049ccf4b583431e14919687f3a39cc227.png#width=300&height=300

[image1]: https://main--site--org.aem.page/media_2c2e2c6c049ccf4b583431e14919687f3a39cc227.png#width=300&height=300
`);
    assert.deepStrictEqual(response.headers.plain(), {
      'content-type': 'text/markdown',
      'cache-control': 'no-store, private, must-revalidate',
      vary: 'Accept-Encoding',
      'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
    });
  });

  it('Rejects document from source bus too many images', async () => {
    nock.source()
      .getObject('/org/site/gallery.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/gallery.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });

    const { request, context } = setupTest('/gallery', {
      config: {
        ...SITE_MUP_CONFIG(),
        limits: {
          html2md: {
            maxImages: 1,
          },
        },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(await response.text(), '');
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to preview '/gallery.html': Documents has more than 1 images: maximum number of images reached: 2 of 1 max.",
      'x-error-code': 'AEM_BACKEND_TOO_MANY_IMAGES',
    });
  });

  it('Rejects document from source if image is too big', async () => {
    nock.source()
      .getObject('/org/site/gallery.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/gallery.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });
    nock.media()
      .headObject('/1c2e2c6c049ccf4b583431e14919687f3a39cc227')
      .times(2)
      .reply(404);

    nock('https://www.example.com')
      .get('/image1.jpg')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/300.png'))
      .get('/image2.jpg')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/300.png'));

    const { request, context } = setupTest('/gallery', {
      config: {
        ...SITE_MUP_CONFIG(),
        limits: {
          preview: {
            maxImageSize: 100,
          },
        },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(await response.text(), '');
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to preview '/gallery.html': Images 1 and 2 exceed allowed limit of 100B",
    });
  });

  it('accepts valid SVG', async () => {
    const svg = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" fill="red"/>
</svg>`);

    nock.source()
      .getObject('/org/site/gallery.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/svg.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });
    nock.media()
      .headObject('/17d55a1d5a57e8fcee802eec435599147fc0935dc')
      .reply(404)
      .putObject('/17d55a1d5a57e8fcee802eec435599147fc0935dc')
      .reply(201);

    nock('https://www.example.com')
      .get('/icon.svg')
      .reply(200, svg, {
        'content-type': 'image/svg+xml',
        'content-length': svg.length,
      });

    const { request, context } = setupTest('/gallery', {
      config: {
        ...SITE_MUP_CONFIG(),
        limits: {
          preview: {
            maxSVGSize: 40000,
          },
        },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/markdown',
      'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
      vary: 'Accept-Encoding',
    });
  });

  it('rejects invalid SVG', async () => {
    const svg = Buffer.from('<xml xmlns="http://www.w3.org/2000/svg"><circle cx="40" cy="40" r="24" style="stroke:#006600; fill:#00cc00"/></xml>');

    nock.source()
      .getObject('/org/site/gallery.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/svg.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });
    nock.media()
      .headObject('/199c601995c217244407df21d6a1d71b0e83f3ffb')
      .reply(404);

    nock('https://www.example.com')
      .get('/icon.svg')
      .reply(200, svg, {
        'content-type': 'image/svg+xml',
        'content-length': svg.length,
      });

    const { request, context } = setupTest('/gallery', {
      config: {
        ...SITE_MUP_CONFIG(),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(await response.text(), '');
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to preview '/gallery.html': Image 1 failed validation: Expected XML content with an SVG root item",
    });
  });

  it('rejects large SVG', async () => {
    const svg = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" fill="red"/>
</svg>`);

    nock.source()
      .getObject('/org/site/gallery.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/svg.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });
    nock.media()
      .headObject('/17d55a1d5a57e8fcee802eec435599147fc0935dc')
      .reply(404);

    nock('https://www.example.com')
      .get('/icon.svg')
      .reply(200, svg, {
        'content-type': 'image/svg+xml',
        'content-length': svg.length,
      });

    const { request, context } = setupTest('/gallery', {
      config: {
        ...SITE_MUP_CONFIG(),
        limits: {
          preview: {
            maxSVGSize: 40,
          },
        },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(await response.text(), '');
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to preview '/gallery.html': Image 1 failed validation: SVG is larger than 40B: 146B",
    });
  });

  it('rejects single large image', async () => {
    nock.source()
      .getObject('/org/site/gallery.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/svg.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });
    nock.media()
      .headObject('/1c2e2c6c049ccf4b583431e14919687f3a39cc227')
      .reply(404);

    nock('https://www.example.com')
      .get('/icon.svg')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/300.png'))
      .get('/image2.jpg');

    const { request, context } = setupTest('/gallery', {
      config: {
        ...SITE_MUP_CONFIG(),
        limits: {
          preview: {
            maxImageSize: 40,
          },
        },
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(await response.text(), '');
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to preview '/gallery.html': Image 1 exceeds allowed limit of 40B",
    });
  });

  it('rejects invalid SVG, large image and ignores non image', async () => {
    const svg = Buffer.from('<xml xmlns="http://www.w3.org/2000/svg"><circle cx="40" cy="40" r="24" style="stroke:#006600; fill:#00cc00"/></xml>');

    nock.source()
      .getObject('/org/site/gallery.html')
      .replyWithFile(200, resolve(__testdir, 'contentproxy/fixtures/sourcebus/svg-mix.html'), {
        'last-modified': 'Thu, 11 Dec 2025 12:00:00 GMT',
        'content-type': 'text/html',
      });
    nock.media()
      .headObject('/199c601995c217244407df21d6a1d71b0e83f3ffb')
      .reply(404)
      .headObject('/120b6669c77e35fb2ad9563a4a048701b43948bd3')
      .reply(404)
      .headObject('/1234dea2862775a45dbc9311cff50ae57eba56eba')
      .reply(404);

    nock('https://www.example.com')
      .get('/icon.svg')
      .reply(200, svg, {
        'content-type': 'image/svg+xml',
        'content-length': svg.length,
      })
      .get('/icon.txt')
      .reply(200, 'hello, world!', {
        'content-type': 'text/plain; charset=utf-8',
      })
      .get('/icon.png')
      .reply(200, Buffer.alloc(25 * 1025 * 1024), {
        'content-type': 'image/png',
        'content-length': 25 * 1024 * 1024,
      });

    const { request, context } = setupTest('/gallery', {
      config: {
        ...SITE_MUP_CONFIG(),
      },
    });
    const response = await main(request, context);

    assert.strictEqual(response.status, 409);
    assert.strictEqual(await response.text(), '');
    assert.deepStrictEqual(response.headers.plain(), {
      'cache-control': 'no-store, private, must-revalidate',
      'content-type': 'text/plain; charset=utf-8',
      'x-error': "Unable to preview '/gallery.html': Images 1 and 3 have failed validation.",
    });
  });
});

describe('ValidationError SVG Test', () => {
  it('validates an SVG that has a script tag', async () => {
    const contents = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 56 54" style="enable-background:new 0 0 56 54;" xml:space="preserve">
   <circle cx="40" cy="40" r="24" style="stroke:#006600; fill:#00cc00">
    <script>alert('I can do evil things...');</script>
  </circle>
</svg>`);
    await assert.rejects(validateSVG(createContext('/'), contents, 1000), new SVGValidationError('Script or event handler detected in SVG at: /svg/circle[0]'));
  });

  it('validates an SVG that has an onload handler', async () => {
    const contents = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" onload="alert('XSS')">
  <rect width="100" height="100" fill="red"/>
</svg>`);

    await assert.rejects(validateSVG(createContext('/'), contents, 1000), new SVGValidationError('Script or event handler detected in SVG at: /svg'));
  });

  it('validates an SVG that has an unexpected character', async () => {
    const contents = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
  <svg version="1.1" id="Adobe_Express_Logo" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns:graph="&ns_graphs;"
      xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 240 234"
      style="enable-background:new 0 0 240 234;" xml:space="preserve">
      <!-- foo ->
  </svg>`);
    await assert.rejects(validateSVG(createContext('/'), contents, 1000), new SVGValidationError('Unable to parse SVG XML'));
  });

  it('validates an SVG', async () => {
    const contents = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 56 54" style="enable-background:new 0 0 56 54;" xml:space="preserve">
  <circle cx="40" cy="40" r="24" style="stroke:#006600; fill:#00cc00"/>
</svg>`);

    await assert.rejects(validateSVG(createContext('/'), contents, 10), new SVGValidationError('SVG is larger than 10B: 313B'));
  });
});
