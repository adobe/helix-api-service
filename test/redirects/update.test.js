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
import { updateRedirects } from '../../src/redirects/update.js';
import { createContext, Nock, SITE_CONFIG } from '../utils.js';

const ENV = {
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'fake-key-id',
  AWS_SECRET_ACCESS_KEY: 'fake-secret',
  CLOUDFLARE_ACCOUNT_ID: 'fake-account-id',
  CLOUDFLARE_R2_ACCESS_KEY_ID: 'fake-key-id',
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'fake-secret',
};

describe('Redirects update tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  const { contentBusId } = SITE_CONFIG.content;

  it('updates redirects correctly on content-bus', async () => {
    const TESTED_HEADERS = {
      'x-amz-meta-redirect-location': true,
      'x-amz-meta-x-source-location': true,
      'x-amz-meta-access-control-allow-origin': true,
      'content-encoding': true,
      'content-type': true,
    };

    const puts = { s3: {}, r2: {} };
    const copy = { s3: {}, r2: {} };
    const deletes = { s3: {}, r2: {} };

    nock.content()
      .put(/.*\?x-id=PutObject/)
      .reply(function fn(uri) {
        puts.s3[uri] = Object.fromEntries(
          Object.entries(this.req.headers).filter(([key]) => key in TESTED_HEADERS),
        );
        return [200];
      })
      .put(/.*\?x-id=CopyObject/)
      .times(3)
      .reply(function fn(uri) {
        copy.s3[uri] = Object.fromEntries(
          Object.entries(this.req.headers).filter(([key]) => key in TESTED_HEADERS),
        );
        return [200, '<?xml version="1.0" encoding="UTF-8"?>\n<CopyObjectResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LastModified>2021-05-05T08:37:23.000Z</LastModified><ETag>&quot;f278c0035a9b4398629613a33abe6451&quot;</ETag></CopyObjectResult>'];
      })
      .post(/.*\?delete=/)
      .reply((uri) => {
        deletes.s3[uri] = true;
        return [200, '<?xml version="1.0" encoding="UTF-8"?>\n<DeleteResult><Deleted><Key>/foo</Key></Deleted><Deleted><Key>/bar</Key></Deleted></DeleteResult>'];
      })
      .head('/preview/modified-content')
      .reply(200, '', {
        'content-type': 'text/markdown',
        'content-encoding': 'gzip',
        'x-amz-meta-redirect-location': 'before.html',
        'x-amz-meta-x-source-location': 'gdrive:1234',
      })
      .head('/preview/modified-redirect')
      .reply(200, '', {
        'x-amz-meta-redirect-location': 'before.html',
      })
      .head('/preview/same-redirect')
      .reply(200, '', {
        'x-amz-meta-redirect-location': 'same.html',
      })
      .head('/preview/deleted-content')
      .reply(200, '', {
        'x-amz-meta-redirect-location': 'before.html',
        'x-amz-meta-x-source-location': 'gdrive:1234',
      })
      .head('/preview/deleted-redirect')
      .reply(200, '', {
        'x-amz-meta-redirect-location': 'before.html',
      })
      .head('/preview/deleted-never-existed')
      .reply(404)
      .head('/preview/new')
      .reply(404);

    nock('https://helix-content-bus.fake-account-id.r2.cloudflarestorage.com')
      .put(/.*\?x-id=PutObject/)
      .reply(function fn(uri) {
        puts.r2[uri] = this.req.headers['x-amz-meta-redirect-location'];
        return [200];
      })
      .put(/.*\?x-id=CopyObject/)
      .times(3)
      .reply(function fn(uri) {
        copy.r2[uri] = Object.fromEntries(
          Object.entries(this.req.headers).filter(([key]) => key in TESTED_HEADERS),
        );
        return [200, '<?xml version="1.0" encoding="UTF-8"?>\n<CopyObjectResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LastModified>2021-05-05T08:37:23.000Z</LastModified><ETag>&quot;f278c0035a9b4398629613a33abe6451&quot;</ETag></CopyObjectResult>'];
      })
      .post(/.*\?delete=/)
      .reply((uri) => {
        deletes.r2[uri] = true;
        return [200, '<?xml version="1.0" encoding="UTF-8"?>\n<DeleteResult><Deleted><Key>/foo</Key></Deleted><Deleted><Key>/bar</Key></Deleted></DeleteResult>'];
      });

    const config = {
      ...SITE_CONFIG,
      headers: {
        '/**': [
          { key: 'access-control-allow-origin', value: '*' },
        ],
      },
    };
    const context = createContext('/org/sites/site/preview/', {
      attributes: {
        config,
      },
      env: ENV,
    });
    const ret = await updateRedirects(
      context,
      'preview',
      {
        '/modified-content': 'before.html',
        '/modified-redirect': 'before.html',
        '/same-redirect': 'same-missmatch.html',
        '/same': 'same.html',
        '/deleted-content': 'deleted.html',
        '/deleted-redirect': 'deleted.html',
        '/deleted-never-existed': 'deleted.html',
      },
      {
        '/modified-content': 'after.html',
        '/modified-redirect': 'after.html',
        '/same': 'same.html',
        '/same-redirect': 'same.html',
        '/new': 'new.html',
      },
    );

    assert.deepStrictEqual(puts.s3, {
      [`/${contentBusId}/preview/new?x-id=PutObject`]: {
        'content-type': 'text/plain',
        'x-amz-meta-access-control-allow-origin': '*',
        'x-amz-meta-redirect-location': 'new.html',
      },
    });
    assert.deepStrictEqual(puts.r2, {
      [`/${contentBusId}/preview/new?x-id=PutObject`]: 'new.html',
    });
    assert.deepStrictEqual(deletes.s3, {
      '/?delete=': true,
    });
    assert.deepStrictEqual(deletes.r2, {
      '/?delete=': true,
    });
    assert.deepStrictEqual(copy.s3, {
      [`/${contentBusId}/preview/deleted-content?x-id=CopyObject`]: {
        'x-amz-meta-x-source-location': 'gdrive:1234',
      },
      [`/${contentBusId}/preview/modified-content?x-id=CopyObject`]: {
        'content-encoding': 'gzip',
        'content-type': 'text/markdown',
        'x-amz-meta-redirect-location': 'after.html',
        'x-amz-meta-x-source-location': 'gdrive:1234',
      },
      [`/${contentBusId}/preview/modified-redirect?x-id=CopyObject`]: {
        'x-amz-meta-access-control-allow-origin': '*',
        'x-amz-meta-redirect-location': 'after.html',
      },
    });
    assert.deepStrictEqual(copy.r2, {
      [`/${contentBusId}/preview/deleted-content?x-id=CopyObject`]: {
        'x-amz-meta-x-source-location': 'gdrive:1234',
      },
      [`/${contentBusId}/preview/modified-content?x-id=CopyObject`]: {
        'content-encoding': 'gzip',
        'content-type': 'text/markdown',
        'x-amz-meta-redirect-location': 'after.html',
        'x-amz-meta-x-source-location': 'gdrive:1234',
      },
      [`/${contentBusId}/preview/modified-redirect?x-id=CopyObject`]: {
        'x-amz-meta-access-control-allow-origin': '*',
        'x-amz-meta-redirect-location': 'after.html',
      },
    });

    assert.deepStrictEqual(ret.sort(), [
      '/deleted-content',
      '/deleted-redirect',
      '/modified-content',
      '/modified-redirect',
      '/new',
    ]);
  });

  it('ignored redirects are returned if forceUpdateRedirects is set', async () => {
    nock.content()
      .head('/preview/same-redirect')
      .reply(200, '', {
        'x-amz-meta-redirect-location': 'same.html',
      });

    const config = {
      ...SITE_CONFIG,
      headers: {
        '/**': [
          { key: 'access-control-allow-origin', value: '*' },
        ],
      },
    };
    const context = createContext('/org/sites/site/preview/', {
      attributes: {
        config,
      },
      data: {
        forceUpdateRedirects: true,
      },
    });
    const ret = await updateRedirects(context, 'preview', {}, {
      '/same-redirect': 'same.html',
    });

    assert.deepStrictEqual(ret.sort(), [
      '/same-redirect',
    ]);
  });

  it('handles errors from content-bus while deleting', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .head(/.*/)
      .times(2)
      .reply(200, '', {
        'x-amz-meta-redirect-location': 'dummy',
      })
      .post('/?delete=')
      .reply(403);

    const context = createContext('/org/sites/site/preview/', {
      attributes: {
        config: SITE_CONFIG,
        env: ENV,
      },
    });
    const ret = await updateRedirects(
      context,
      'preview',
      {
        '/tag/inside-adobe/index.md': 'https://blog.adobe.com/en/topics/adobe-culture.html',
        '/tag/coronavirus/index.md': 'https://blog.adobe.com/en/topics/covid-19.html',
      },
      {},
    );
    assert.deepStrictEqual(ret, []);
  });

  it('handles errors from content-bus while updating', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .head(/.*/)
      .reply(404)
      .put(`/${contentBusId}/preview/tag/inside-adobe/index.md?x-id=PutObject`)
      .reply(403);

    const context = createContext('/org/sites/site/preview/', {
      attributes: {
        config: SITE_CONFIG,
        env: ENV,
      },
    });
    const ret = await updateRedirects(
      context,
      'preview',
      {},
      {
        '/tag/inside-adobe/index.md': 'https://blog.adobe.com/en/topics/adobe-culture.html',
      },
    );
    assert.deepStrictEqual(ret, []);
  });

  it('handles errors from content-bus while updating existing content', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .head(`/${contentBusId}/preview/tag/inside-adobe/index.md`)
      .reply(200)
      .put(`/${contentBusId}/preview/tag/inside-adobe/index.md?x-id=CopyObject`)
      .reply(403);

    const context = createContext('/org/sites/site/preview/', {
      attributes: {
        config: SITE_CONFIG,
        env: ENV,
      },
    });

    const ret = await updateRedirects(
      context,
      'preview',
      {},
      {
        '/tag/inside-adobe/index.md': 'https://blog.adobe.com/en/topics/adobe-culture.html',
      },
    );
    assert.deepStrictEqual(ret, []);
  });
});
