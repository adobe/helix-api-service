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
import snapshotHandler from '../../src/snapshot/handler.js';
import purge from '../../src/cache/purge.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

const CONTENT_BUS_ID = SITE_CONFIG.content.contentBusId;

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
  });

  afterEach(() => {
    sandbox.restore();
    nock.done();
  });

  it('returns 405 for unsupported methods', async () => {
    const context = createTestContext('/org/sites/site/snapshots/test-snap');
    const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'PUT');
    const res = await snapshotHandler(context, info);
    assert.strictEqual(res.status, 405);
  });

  it('returns 400 when snapshotId is missing for non-list requests', async () => {
    const context = createTestContext('/org/sites/site/snapshots', {});
    const info = createInfo('/org/sites/site/snapshots', {}, 'POST');
    const res = await snapshotHandler(context, info);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.headers.get('x-error'), 'invalid path parameters: "snapshotId" is required');
  });

  describe('LIST snapshots', () => {
    it('lists snapshots', async () => {
      nock.listFolders('helix-content-bus', `${CONTENT_BUS_ID}/preview/.snapshots/`, ['snap1', 'snap2']);
      const context = createTestContext('/org/sites/site/snapshots');
      const info = createInfo('/org/sites/site/snapshots');
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
      const context = createTestContext('/org/sites/site/snapshots/test-snap');
      const info = createInfo('/org/sites/site/snapshots/test-snap');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.manifest);
      assert.strictEqual(body.manifest.id, 'test-snap');
    });

    it('returns 404 for non-existing snapshot', async () => {
      manifestNock(nock, null);
      const context = createTestContext('/org/sites/site/snapshots/test-snap');
      const info = createInfo('/org/sites/site/snapshots/test-snap');
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
      const context = createTestContext('/org/sites/site/snapshots/test-snap', {
        title: 'New Title',
      });
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'POST');
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
      const context = createTestContext('/org/sites/site/snapshots/test-snap', {
        locked: true,
        disableNotifications: true,
      });
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'POST');
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
      const context = createTestContext('/org/sites/site/snapshots/test-snap', {
        locked: 'invalid',
      });
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'POST');
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

      const context = createTestContext('/org/sites/site/snapshots/test-snap/missing');
      const info = createInfo('/org/sites/site/snapshots/test-snap/missing', {}, 'POST');
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
      const context = createTestContext('/org/sites/site/snapshots/test-snap');
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'DELETE');
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
      const context = createTestContext('/org/sites/site/snapshots/test-snap');
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'DELETE');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.headers.get('x-error'), 'cannot delete snapshot containing resources');
    });

    it('returns 404 when deleting non-existing snapshot', async () => {
      manifestNock(nock, null);
      const context = createTestContext('/org/sites/site/snapshots/test-snap');
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'DELETE');
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

      const context = createTestContext('/org/sites/site/snapshots/test-snap', {
        review: 'request',
      });
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'POST');
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

      const context = createTestContext('/org/sites/site/snapshots/test-snap', {
        review: 'request',
      });
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'POST');
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

      const context = createTestContext('/org/sites/site/snapshots/test-snap', {
        review: 'reject',
      });
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'POST');
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

      const context = createTestContext('/org/sites/site/snapshots/test-snap', {
        review: 'invalid',
      });
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'POST');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 400);
    });

    it('returns 404 when reviewing non-existing manifest', async () => {
      manifestNock(nock, null);

      const context = createTestContext('/org/sites/site/snapshots/test-snap', {
        review: 'request',
      });
      const info = createInfo('/org/sites/site/snapshots/test-snap', {}, 'POST');
      const res = await snapshotHandler(context, info);
      assert.strictEqual(res.status, 404);
    });
  });
});
