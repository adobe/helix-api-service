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
import {
  getFetchHeaders, jsonPath, fetchExtendedIndex,
  getTasksQueue, loadIndexData,
} from '../../src/index/utils.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

describe('Index Utils Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  const suffix = '/org/sites/site/index/document';

  it('checks `getFetchHeaders`', async () => {
    const context = createContext(suffix, {
      attributes: {
        config: {
          ...SITE_CONFIG,
          access: {
            allow: '*@adobe.com',
          },
        },
      },
      env: {
        HLX_GLOBAL_DELIVERY_TOKEN: 'hlx_example-token',
      },
    });
    const token = getFetchHeaders(context);
    assert.strictEqual(token.authorization, 'token hlx_example-token');
  });

  it('checks `jsonPath`', () => {
    assert.strictEqual(jsonPath(undefined), null);
    assert.strictEqual(jsonPath('s3://query-index.json'), '/query-index.json');
    assert.strictEqual(jsonPath('/query-index'), '/query-index.json');
    assert.strictEqual(jsonPath('/query-index.xlsx'), '/query-index.json');
  });

  describe('check `fetchExtendedIndex`', () => {
    it('does not add simple sitemap index if index configuration contains errors', async () => {
      const INDEX_CONFIG = `
      indices:
        default:
          target: /query-index.json
          properties:
            title:
              select: head > meta[property="og:title"]
              value: |
                attribute(el, 'content')
            title:
              select: none
              value: |
                parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')
      `;

      nock.indexConfig(INDEX_CONFIG);

      const context = createContext(suffix);
      const info = createInfo(suffix);

      const index = await fetchExtendedIndex(context, info);
      assert.throws(() => index.toYAML(), /Document with errors cannot be stringified/);
    });

    it('extends index if no sitemap defined', async () => {
      const INDEX_CONFIG = `
      indices:
        default:
          target: /query-index.json
          properties:
            title:
              select: head > meta[property="og:title"]
              value: |
                attribute(el, 'content')
      `;
      nock.indexConfig(INDEX_CONFIG);
      nock.sitemapConfig(null);
      nock.content()
        .head('/live/sitemap.json')
        .reply(200);

      const context = createContext(suffix);
      const info = createInfo(suffix);

      const index = await fetchExtendedIndex(context, info);
      assert.strictEqual(index.indices[1].name, '#internal-sitemap-index');
    });
  });

  it('checks `getTasksQueue`', async () => {
    assert.strictEqual(getTasksQueue('us-east-1', '1234567890', false), 'https://sqs.us-east-1.amazonaws.com/1234567890/helix-indexer.fifo');
    assert.strictEqual(getTasksQueue('us-east-1', '1234567890', true), 'https://sqs.us-east-1.amazonaws.com/1234567890/test-indexer.fifo');
  });

  describe('checks `loadIndexData`', async () => {
    const INDEX_CONFIG = `
    indices:
      default:
        target: /query-index.json
        properties:
          title:
            select: head > meta[property="og:title"]
            value: |
              attribute(el, 'content')
    `;

    function setupTest() {
      const context = createContext(suffix);
      const info = createInfo(suffix);
      return { context, info };
    }

    beforeEach(() => {
      nock.indexConfig(INDEX_CONFIG);
      nock.sitemapConfig(null);
      nock.content()
        .head('/live/sitemap.json')
        .reply(404);
    });

    it('ignores index data if not found', async () => {
      nock.content()
        .getObject('/live/query-index.json')
        .reply(404);

      const { context, info } = setupTest();

      const index = await fetchExtendedIndex(context, info);
      const data = await loadIndexData(context, index);
      assert.deepStrictEqual(data, {});
    });

    it('ignores index data if not JSON parseable', async () => {
      nock.content()
        .getObject('/live/query-index.json')
        .reply(200, 'not valid json');

      const { context, info } = setupTest();

      const index = await fetchExtendedIndex(context, info);
      const data = await loadIndexData(context, index);
      assert.deepStrictEqual(data, {});
    });
  });
});
