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
import nockLib from 'nock';
import xml2js from 'xml2js';
import { Response } from '@adobe/fetch';
import snapshotHandler from '../../src/snapshot/handler.js';
import purge from '../../src/cache/purge.js';
import { Job } from '../../src/job/Job.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

const CONTENT_BUS_ID = SITE_CONFIG.content.contentBusId;

const MANIFEST_WITH_RESOURCES = {
  id: 'test-snap',
  created: '2025-01-01T00:00:00Z',
  lastModified: '2025-01-01T00:00:00Z',
  resources: [
    { path: '/welcome', status: 200 },
    { path: '/old-page', status: 404 },
  ],
};

const SNS_RESPONSE_BODY = new xml2js.Builder().buildObject({
  PublishResponse: {
    PublishResult: {
      SequenceNumber: '1',
      MessageId: '1',
    },
  },
});

function mockSns(times = 1) {
  nockLib('https://sns.us-east-1.amazonaws.com:443')
    .post('/')
    .times(times)
    .reply(200, SNS_RESPONSE_BODY);
}

function createTestContext(suffix, data = {}) {
  return createContext(suffix, {
    env: { HELIX_STORAGE_DISABLE_R2: 'true' },
    attributes: {
      config: structuredClone(SITE_CONFIG),
      infoMarkerChecked: true,
    },
    data,
  });
}

function createRequest(suffix, method = 'GET', data = {}) {
  return {
    context: createTestContext(suffix, data),
    info: createInfo(suffix, {}, method),
  };
}

function manifestNock(nk, manifestData, snapshotId = 'test-snap') {
  const key = `/preview/.snapshots/${snapshotId}/.manifest.json`;
  if (manifestData) {
    nk.content().getObject(key).reply(200, JSON.stringify(manifestData));
  } else {
    nk.content().getObject(key).reply(404, '');
  }
}

describe('Snapshot Handler Tests', () => {
  let nock;
  let sandbox;

  beforeEach(() => {
    nock = new Nock().env();
    sandbox = sinon.createSandbox();
    sandbox.stub(purge, 'perform').resolves();
    sandbox.stub(purge, 'content').resolves();
    sandbox.stub(purge, 'resource').resolves();
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('returns 405 for unsupported methods', async () => {
    const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'PUT');
    const res = await snapshotHandler(context, info);
    assert.strictEqual(res.status, 405);
  });

  it('returns 400 when snapshotId is missing for non-list requests', async () => {
    const { context, info } = createRequest('/org/sites/site/snapshots', 'POST');
    const res = await snapshotHandler(context, info);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.headers.get('x-error'), 'invalid path parameters: "snapshotId" is required');
  });

  describe('LIST snapshots', () => {
    it('lists snapshots', async () => {
      nock.listFolders('helix-content-bus', `${CONTENT_BUS_ID}/preview/.snapshots/`, ['snap1', 'snap2']);
      const { context, info } = createRequest('/org/sites/site/snapshots');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.deepStrictEqual(body.snapshots, ['snap1', 'snap2']);
      assert.ok(body.links.self);
    });
  });

  describe('GET manifest', () => {
    it('returns manifest for existing snapshot', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [{ path: '/welcome', status: 200 }],
      };
      manifestNock(nock, manifestData);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.manifest);
      assert.strictEqual(body.manifest.id, 'test-snap');
    });

    it('returns 404 for non-existing snapshot', async () => {
      manifestNock(nock, null);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST update manifest properties', () => {
    it('updates title', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);
      nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        title: 'New Title',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.manifest.title, 'New Title');
    });

    it('locks snapshot', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);
      nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        locked: true,
        disableNotifications: true,
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.manifest.locked);
    });

    it('returns 400 for invalid locked value', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        locked: 'invalid',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 400);
    });
  });

  describe('POST add resource', () => {
    it('adds 404 resource when source does not exist', async () => {
      manifestNock(nock, null);
      nock.content()
        .headObject('/preview/missing.md')
        .reply(404);
      // store manifest
      nock.content()
        .putObject('/preview/.snapshots/test-snap/.manifest.json')
        .reply(200);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/missing', 'POST');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 204);
    });
  });

  describe('DELETE', () => {
    it('deletes empty snapshot', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);
      nock.content().deleteObject('/preview/.snapshots/test-snap/.manifest.json').reply(204);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'DELETE');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 204);
    });

    it('returns 400 when deleting non-empty snapshot', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [{ path: '/foo', status: 200 }],
      };
      manifestNock(nock, manifestData);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'DELETE');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.headers.get('x-error'), 'cannot delete snapshot containing resources');
    });

    it('returns 404 when deleting non-existing snapshot', async () => {
      manifestNock(nock, null);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'DELETE');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('Review workflow', () => {
    it('requests review (locks snapshot)', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [{ path: '/foo', status: 200 }],
      };
      manifestNock(nock, manifestData);
      nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
      mockSns();

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'request',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 204);
    });

    it('returns 409 when requesting review on already locked snapshot', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        locked: '2025-01-01T00:00:00Z',
        resources: [{ path: '/foo', status: 200 }],
      };
      manifestNock(nock, manifestData);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'request',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 409);
    });

    it('rejects review (unlocks snapshot)', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        locked: '2025-01-01T00:00:00Z',
        review: 'requested',
        resources: [{ path: '/foo', status: 200 }],
      };
      manifestNock(nock, manifestData);
      nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
      mockSns();

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'reject',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 204);
    });

    it('returns 400 for invalid review value', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'invalid',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 400);
    });

    it('returns 404 when reviewing non-existing manifest', async () => {
      manifestNock(nock, null);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'request',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 404);
    });

    it('rejects review when not locked (409)', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [{ path: '/foo', status: 200 }],
      };
      manifestNock(nock, manifestData);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'reject',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.headers.get('x-error'), 'snapshot is not locked');
    });

    it('approves with empty resources (unlocks and clears state)', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        locked: '2025-01-01T00:00:00Z',
        review: 'requested',
        resources: [],
      };
      manifestNock(nock, manifestData);
      nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
      mockSns();

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'approve',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 204);
    });

    it('approves with resources (publishes + clears)', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        locked: '2025-01-01T00:00:00Z',
        review: 'requested',
        resources: [
          { path: '/welcome', status: 200 },
          { path: '/old-page', status: 404 },
        ],
      };
      manifestNock(nock, manifestData);
      nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
      mockSns();

      const jobStub = sandbox.stub(Job, 'create').resolves(
        new Response('{}', { status: 200 }),
      );
      // remove snapshot resources after publish (DeleteObjects batch)
      nockLib('https://helix-content-bus.s3.us-east-1.amazonaws.com:443')
        .post('/')
        .query({ delete: '' })
        .reply(200, new xml2js.Builder().buildObject({
          DeleteResult: { Deleted: [{ Key: `${CONTENT_BUS_ID}/preview/.snapshots/test-snap/welcome.md` }] },
        }));

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'approve',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 204);
      assert.ok(jobStub.calledTwice, 'Job.create called for publish and unpublish');
      jobStub.restore();
    });

    it('approve fails when bulkPublish fails', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        locked: '2025-01-01T00:00:00Z',
        review: 'requested',
        resources: [{ path: '/welcome', status: 200 }],
      };
      manifestNock(nock, manifestData);

      const jobStub = sandbox.stub(Job, 'create').resolves(
        new Response('', { status: 500 }),
      );

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'approve',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.headers.get('x-error'), 'failed to publish snapshot');
      jobStub.restore();
    });

    it('approve fails when bulkUnpublish fails', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        locked: '2025-01-01T00:00:00Z',
        review: 'requested',
        resources: [{ path: '/old-page', status: 404 }],
      };
      manifestNock(nock, manifestData);

      const jobStub = sandbox.stub(Job, 'create').resolves(
        new Response('', { status: 500 }),
      );

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'approve',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.headers.get('x-error'), 'failed to remove deleted resources from live');
      jobStub.restore();
    });

    it('request review with message and keepResources', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [{ path: '/foo', status: 200 }],
      };
      manifestNock(nock, manifestData);
      nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
      mockSns();

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'request',
        message: 'Please review',
        keepResources: 'true',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 204);
    });

    it('approve when not locked returns 409', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [{ path: '/foo', status: 200 }],
      };
      manifestNock(nock, manifestData);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        review: 'approve',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.headers.get('x-error'), 'snapshot is not locked');
    });
  });

  describe('POST publish', () => {
    it('publishes snapshot with bulk publish (mixed resources)', async () => {
      manifestNock(nock, MANIFEST_WITH_RESOURCES);

      const jobStub = sandbox.stub(Job, 'create').resolves(
        new Response('{}', { status: 200 }),
      );

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        publish: 'true',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      // bulkPublish for status=200 resources, bulkUnpublish for status=404 resources
      assert.ok(jobStub.calledTwice, 'Job.create called for publish and unpublish');
      jobStub.restore();
    });

    it('single resource publish (status 200)', async () => {
      manifestNock(nock, MANIFEST_WITH_RESOURCES);
      // liveUpdate → publishSnapshot: HEAD source (for addMetadata) + CopyObject dest
      nock.content()
        .headObject('/preview/.snapshots/test-snap/welcome.md')
        .reply(200, '', {
          'content-type': 'text/html',
          'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
        });
      nock.content()
        .copyObject('/live/welcome.md')
        .reply(200, new xml2js.Builder().buildObject({
          CopyObjectResult: { ETag: '123' },
        }));
      // updateRedirect → getRedirects (pre-populated below)

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome', 'POST', {
        publish: 'true',
      });
      // pre-populate redirects to avoid nocking fetchRedirects
      context.attributes.redirects = { live: {} };
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
    });

    it('single resource delete (status 404)', async () => {
      manifestNock(nock, MANIFEST_WITH_RESOURCES);
      // unpublish → contentbusRemove: metadata HEAD + remove for .md
      nock.content()
        .headObject('/live/old-page.md')
        .reply(200, '', {});
      nock.content()
        .deleteObject('/live/old-page.md')
        .reply(204);
      // unpublish → fetchExtendedIndex: query.yaml 404
      nock.indexConfig(null);
      // unpublish → installSimpleSitemap: sitemap.yaml 404 + hasSimpleSitemap HEAD
      nock.sitemapConfig(null);
      nock.content().headObject('/live/sitemap.json').reply(404);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/old-page', 'POST', {
        publish: 'true',
      });
      context.attributes.redirects = { live: {} };
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 204);
    });

    it('returns 404 for resource not in manifest', async () => {
      manifestNock(nock, MANIFEST_WITH_RESOURCES);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/nonexistent', 'POST', {
        publish: 'true',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 404);
    });

    it('glob filter publishes matching resources only', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [
          { path: '/docs/welcome', status: 200 },
          { path: '/blog/post', status: 200 },
          { path: '/docs/old', status: 404 },
        ],
      };
      manifestNock(nock, manifestData);

      const jobStub = sandbox.stub(Job, 'create').resolves(
        new Response('{}', { status: 200 }),
      );

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/docs/*', 'POST', {
        publish: 'true',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      // bulkPublish for /docs/welcome (200) + bulkUnpublish for /docs/old (404)
      assert.ok(jobStub.calledTwice, 'Job.create called for publish and unpublish');
      jobStub.restore();
    });

    it('bulk publish returns 404 when no resources match', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        publish: 'true',
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST bulk operations (webPath=/*)', () => {
    it('bulk snapshot (default, no delete)', async () => {
      manifestNock(nock, null);

      const jobStub = sandbox.stub(Job, 'create').resolves(
        new Response('{}', { status: 200 }),
      );

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/*', 'POST', {
        paths: ['/foo', '/bar'],
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      assert.ok(jobStub.calledOnce, 'Job.create called for bulk snapshot');
      jobStub.restore();
    });

    it('bulk remove (delete=true)', async () => {
      manifestNock(nock, null);

      const jobStub = sandbox.stub(Job, 'create').resolves(
        new Response('{}', { status: 200 }),
      );

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/*', 'POST', {
        delete: 'true',
        paths: ['/foo', '/bar'],
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      assert.ok(jobStub.calledOnce, 'Job.create called for bulk remove');
      jobStub.restore();
    });
  });

  describe('DELETE with webPath', () => {
    it('removes a single resource from snapshot', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [{ path: '/welcome', status: 200 }],
      };
      manifestNock(nock, manifestData);
      // removeSnapshot: HEAD on snapshot resource, then DELETE
      nock.content()
        .headObject('/preview/.snapshots/test-snap/welcome.md')
        .reply(200, '', {})
        .deleteObject('/preview/.snapshots/test-snap/welcome.md')
        .reply(204)
        .putObject('/preview/.snapshots/test-snap/.manifest.json')
        .reply(200);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome', 'DELETE');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 204);
    });

    it('returns 502 when contentbus returns error for resource removal', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [{ path: '/broken', status: 200 }],
      };
      manifestNock(nock, manifestData);
      // removeSnapshot: HEAD returns 500 (triggers catch block → 500 response)
      nock.content()
        .headObject('/preview/.snapshots/test-snap/broken.md')
        .reply(500, '', { 'x-error': 'storage error' })
        .putObject('/preview/.snapshots/test-snap/.manifest.json')
        .reply(200);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/broken', 'DELETE');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 502);
    });

    it('returns 404 when removing resource not in storage', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);
      // removeSnapshot: HEAD returns 404
      nock.content()
        .headObject('/preview/.snapshots/test-snap/missing.md')
        .reply(404);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/missing', 'DELETE');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('GET resource status within snapshot', () => {
    it('returns resource status when resource exists in snapshot', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [{ path: '/welcome', status: 200 }],
      };
      // manifest for handler's Manifest.fromContext
      manifestNock(nock, manifestData);
      // manifest for snapshotStatus's Manifest.fromContext (cached, no nock needed)
      // getContentBusInfo: fetchS3 HEAD on snapshot resource
      nock.content()
        .head('/preview/.snapshots/test-snap/welcome.md')
        .reply(200, '', {
          'content-type': 'text/html',
          'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
          'x-source-location': 'google:abc123',
          'x-last-previewed': 'Wed, 01 Jan 2025 00:00:00 GMT',
        });

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.webPath, '/welcome');
      assert.ok(body.resourcePath.includes('/.snapshots/test-snap/'));
      assert.strictEqual(body.preview.status, 200);
      assert.strictEqual(body.snapshot.id, 'test-snap');
    });

    it('returns resource status when resource is 404 in snapshot', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);
      // getContentBusInfo: fetchS3 HEAD returns 404
      nock.content()
        .head('/preview/.snapshots/test-snap/missing.md')
        .reply(404);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/missing');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.preview.status, 404);
    });

    it('returns error status for non-200/404 response', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);
      // getContentBusInfo: fetchS3 HEAD returns 403
      nock.content()
        .head('/preview/.snapshots/test-snap/forbidden.md')
        .reply(403);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/forbidden');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 502);
    });
  });

  describe('POST update - additional branches', () => {
    it('unlocks snapshot (lock=false requires live:write)', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        locked: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);
      nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
      mockSns();

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        locked: false,
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.manifest.locked, undefined);
    });

    it('locks snapshot with notification', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);
      nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
      mockSns();

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        locked: true,
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.manifest.locked);
    });

    it('returns 400 for property exceeding limit', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap', 'POST', {
        title: 'x'.repeat(5000),
      });
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 400);
      assert.ok(res.headers.get('x-error').includes('exceeds'));
    });

    it('adds resource that already exists (copy + purge + status response)', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        resources: [{ path: '/welcome', status: 200 }],
      };
      manifestNock(nock, manifestData);
      // updateSnapshot: HEAD source for existence check + copy internal HEAD (2 total)
      nock.content()
        .headObject('/preview/welcome.md')
        .times(2)
        .reply(200, '', {
          'content-type': 'text/html',
          'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
        });
      // updateSnapshot: CopyObject to snapshot destination
      nock.content()
        .copyObject('/preview/.snapshots/test-snap/welcome.md')
        .reply(200, new xml2js.Builder().buildObject({
          CopyObjectResult: { ETag: '123' },
        }));
      // snapshotStatus: getContentBusInfo HEAD on snapshot resource
      nock.content()
        .head('/preview/.snapshots/test-snap/welcome.md')
        .reply(200, '', {
          'content-type': 'text/html',
          'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
          'x-source-location': 'google:abc123',
        });
      // manifest store
      nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome', 'POST');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.webPath, '/welcome');
      // verify purge was called for the existing resource
      assert.ok(purge.content.called, 'purge.content should be called for existing resource');
    });

    it('returns 409 when adding resource to locked snapshot', async () => {
      const manifestData = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        locked: '2025-01-01T00:00:00Z',
        resources: [],
      };
      manifestNock(nock, manifestData);

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome', 'POST');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 409);
    });

    it('returns 502 for contentbus error when adding resource', async () => {
      manifestNock(nock, null);
      // updateSnapshot: HEAD source returns 500
      nock.content()
        .headObject('/preview/broken.md')
        .reply(500, '', { 'x-error': 'internal error' });

      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/broken', 'POST');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 502);
    });
  });
});
