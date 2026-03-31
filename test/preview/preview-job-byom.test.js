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
import xml2js from 'xml2js';
import { Response } from '@adobe/fetch';
import sinon from 'sinon';

import { AuthInfo } from '../../src/auth/auth-info.js';
import { HANDLERS } from '../../src/contentproxy/index.js';
import purge from '../../src/cache/purge.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';
import { createJob as createPreviewJob } from './preview-job.test.js';
import { toResourcePath } from '../../src/support/RequestInfo.js';

const SNS_RESPONSE_BODY = new xml2js.Builder().buildObject({
  PublishResponse: {
    PublishResult: {
      SequenceNumber: '1',
      MessageId: '1',
    },
  },
});

/**
 * Primary SharePoint-like handler. Returns 4 files found, 4 files as 404 (BYOM paths).
 */
const createSharepointHandler = () => ({
  get name() { return 'sharepoint-test'; },
  async handle() { return new Response('ok'); },
  async list(ctx, info, paths, cb) {
    const cont = await cb({ total: 8 });
    if (!cont) return [];
    return [
      {
        path: '/sp/doc',
        resourcePath: '/sp/doc.md',
        source: { contentType: 'application/octet-stream', lastModified: 1000, type: 'onedrive' },
      },
      {
        path: '/sp/not-modified',
        resourcePath: '/sp/not-modified.md',
        source: { contentType: 'application/octet-stream', lastModified: 0, type: 'onedrive' },
      },
      // These paths are not in SharePoint → 404, will be re-collected from overlay
      { path: '/byom/new-doc', resourcePath: '/byom/new-doc.md', status: 404 },
      { path: '/byom/existing', resourcePath: '/byom/existing.md', status: 404 },
    ];
  },
});

/**
 * Overlay handler. Resolves the 404 paths from SharePoint.
 */
const createOverlayHandler = () => ({
  get name() { return 'byom-overlay'; },
  async handle() { return new Response('ok'); },
  async list(ctx, info, paths, cb) {
    const cont = await cb({ total: paths.length });
    if (!cont) return [];
    return paths.map((p) => ({
      path: p,
      resourcePath: `${p}.md`,
      source: {
        contentType: 'text/markdown; charset=utf-8',
        lastModified: 1_000_000,
        type: 'markup',
      },
    }));
  },
});

/**
 * BYOM-only handler (markup source type, no SharePoint).
 */
const createByomHandler = () => ({
  get name() { return 'byom-test'; },
  async handle() { return new Response('ok'); },
  async list(ctx, info, paths, cb) {
    const cont = await cb({ total: paths.length });
    if (!cont) return [];
    return paths
      .filter((p) => !p.endsWith('/*'))
      .map((p) => ({
        path: p,
        resourcePath: toResourcePath(p),
        source: {
          contentType: 'application/octet-stream',
          lastModified: 1000,
          type: 'markup',
        },
      }));
  },
});

const makeConfig = (sourceType, overlay) => ({
  content: {
    contentBusId: SITE_CONFIG.content.contentBusId,
    source: { type: sourceType, url: `${sourceType}://example.com` },
    ...(overlay ? { overlay } : {}),
  },
  code: {
    owner: 'owner',
    repo: 'repo',
    source: { type: 'github', url: 'https://github.com/owner/repo' },
  },
});

const createJob = async (context, info, paths) => {
  const job = await createPreviewJob(context, info, paths);
  // Stub processFile to avoid real S3 calls; just marks the file as updated
  job.processFile = async function processFile(file) {
    // eslint-disable-next-line no-param-reassign
    file.status = 200;
  };
  return job;
};

describe('BYOM PreviewJob Tests', () => {
  /** @type {import('../utils.js').NockEnv} */
  let nock;

  /** @type {import('sinon').SinonSandbox} */
  let sandbox;

  let context;
  let info;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
    sandbox.stub(purge, 'perform').resolves();
    sandbox.stub(purge, 'config').resolves();
    sandbox.stub(purge, 'redirects').resolves();
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  describe('collect() with overlay', () => {
    beforeEach(() => {
      HANDLERS['sharepoint-test'] = createSharepointHandler();
      HANDLERS['byom-overlay'] = createOverlayHandler();
      context = createContext('/org/sites/site/preview/*', {
        attributes: {
          authInfo: AuthInfo.Admin(),
          config: makeConfig('sharepoint-test', { type: 'byom-overlay', url: 'byom-overlay://example.com' }),
          infoMarkerChecked: true,
        },
      });
      info = createInfo('/org/sites/site/preview/*');
    });

    afterEach(() => {
      delete HANDLERS['sharepoint-test'];
      delete HANDLERS['byom-overlay'];
    });

    it('resolves 404 paths from primary via overlay handler', async () => {
      const job = await createJob(context, info, ['/sp/doc', '/sp/not-modified', '/byom/new-doc', '/byom/existing']);

      // First collect: primary handler returns 2 found + 2 as 404
      await job.collect(job.state.data.paths);
      const after404 = job.state.data.resources.filter(({ status }) => status === 404);
      assert.strictEqual(after404.length, 2);
      assert.deepStrictEqual(after404.map(({ path }) => path), ['/byom/new-doc', '/byom/existing']);

      // Second collect: overlay resolves the 404 paths
      const unresolvedPaths = after404.map(({ path }) => path);
      job.state.data.resources = job.state.data.resources.filter(({ status }) => status !== 404);
      await job.collect(unresolvedPaths, context.attributes.config.content.overlay);

      const resolved = job.state.data.resources.filter(({ path }) => path.startsWith('/byom/'));
      assert.strictEqual(resolved.length, 2);
      assert.ok(resolved.every(({ source }) => source?.type === 'markup'));
    });

    it('run() completes with overlay and uses DOCBASED rate limit for mixed sources', async () => {
      nock('https://sns.us-east-1.amazonaws.com:443').post('/').reply(200, SNS_RESPONSE_BODY);

      const job = await createJob(context, info, ['/sp/doc', '/sp/not-modified', '/byom/new-doc', '/byom/existing']);
      const rateLimitSpy = sinon.spy(job, 'getRateLimit');

      await job.run();

      assert.strictEqual(job.state.data.phase, 'completed');
      // Mixed sources (onedrive + markup) → DOCBASED rate limit
      assert.ok(rateLimitSpy.called);
      const rateLimit = rateLimitSpy.returnValues[0];
      assert.strictEqual(rateLimit.maxConcurrent, 4);
      assert.strictEqual(rateLimit.limit, 1000);

      // Overlay paths should be in resources
      const overlayResources = job.state.data.resources.filter(({ path }) => path.startsWith('/byom/'));
      assert.strictEqual(overlayResources.length, 2);
    });
  });

  describe('BYOM mountpoint (no overlay)', () => {
    beforeEach(() => {
      HANDLERS['byom-test'] = createByomHandler();
      context = createContext('/org/sites/site/preview/*', {
        attributes: {
          authInfo: AuthInfo.Admin(),
          config: makeConfig('byom-test'),
          infoMarkerChecked: true,
        },
      });
      info = createInfo('/org/sites/site/preview/*');
    });

    afterEach(() => {
      delete HANDLERS['byom-test'];
    });

    it('run() completes with BYOM mountpoint using BYOM rate limit', async () => {
      nock('https://sns.us-east-1.amazonaws.com:443').post('/').reply(200, SNS_RESPONSE_BODY);

      const paths = ['/doc', '/products/index', '/byom/page', '/config.json'];
      const job = await createJob(context, info, paths);
      const rateLimitSpy = sinon.spy(job, 'getRateLimit');

      await job.run();

      assert.strictEqual(job.state.data.phase, 'completed');
      // All markup sources → BYOM rate limit
      assert.ok(rateLimitSpy.called);
      const rateLimit = rateLimitSpy.returnValues[0];
      assert.strictEqual(rateLimit.maxConcurrent, 100);
      assert.strictEqual(rateLimit.limit, 600);
      assert.ok(purge.perform.called);
    });

    it('collect() returns all resources with markup source type', async () => {
      const paths = ['/doc', '/page', '/config.json'];
      const job = await createJob(context, info, paths);

      await job.collect(paths);

      assert.strictEqual(job.state.data.resources.length, 3);
      assert.ok(job.state.data.resources.every(({ source }) => source?.type === 'markup'));
    });

    it('collect() correctly maps / path to resourcePath /index.md', async () => {
      const job = await createJob(context, info, ['/']);

      await job.collect(['/']);

      assert.strictEqual(job.state.data.resources.length, 1);
      const [resource] = job.state.data.resources;
      assert.strictEqual(resource.path, '/');
      assert.strictEqual(resource.resourcePath, '/index.md');
    });
  });

  describe('BYOM mountpoint with overlay', () => {
    beforeEach(() => {
      HANDLERS['byom-test'] = createByomHandler();
      HANDLERS['byom-overlay'] = createOverlayHandler();
      context = createContext('/org/sites/site/preview/*', {
        attributes: {
          authInfo: AuthInfo.Admin(),
          config: makeConfig('byom-test', { type: 'byom-overlay', url: 'byom-overlay://example.com' }),
          infoMarkerChecked: true,
        },
      });
      info = createInfo('/org/sites/site/preview/*');
    });

    afterEach(() => {
      delete HANDLERS['byom-test'];
      delete HANDLERS['byom-overlay'];
    });

    it('run() completes with BYOM mountpoint and overlay using BYOM rate limit', async () => {
      nock('https://sns.us-east-1.amazonaws.com:443').post('/').reply(200, SNS_RESPONSE_BODY);

      // BYOM handler returns no 404s, so overlay won't be invoked for re-collection
      const paths = ['/doc', '/products/index', '/config.json'];
      const job = await createJob(context, info, paths);
      const rateLimitSpy = sinon.spy(job, 'getRateLimit');

      await job.run();

      assert.strictEqual(job.state.data.phase, 'completed');
      // All markup sources → BYOM rate limit
      const rateLimit = rateLimitSpy.returnValues[0];
      assert.strictEqual(rateLimit.maxConcurrent, 100);
      assert.strictEqual(rateLimit.limit, 600);
    });
  });
});
