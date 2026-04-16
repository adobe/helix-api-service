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
import { updateSnapshot, publishSnapshot, removeSnapshot } from '../../src/contentbus/snapshot.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

const MANIFEST_KEY = '/preview/.snapshots/test-snap/.manifest.json';

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

function manifestNock(nk, manifestData) {
  if (manifestData) {
    nk.content().getObject(MANIFEST_KEY).reply(200, JSON.stringify(manifestData));
  } else {
    nk.content().getObject(MANIFEST_KEY).reply(404, '');
  }
}

const EXISTING_MANIFEST = {
  id: 'test-snap',
  created: '2025-01-01T00:00:00Z',
  lastModified: '2025-01-01T00:00:00Z',
  resources: [
    { path: '/welcome', status: 200 },
    { path: '/deleted', status: 404 },
  ],
};

const LOCKED_MANIFEST = {
  ...EXISTING_MANIFEST,
  locked: '2025-01-01T00:00:00Z',
};

describe('contentbus/snapshot.js', () => {
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  describe('updateSnapshot()', () => {
    it('returns 404 for .helix/ paths', async () => {
      manifestNock(nock, EXISTING_MANIFEST);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/.helix/config', 'POST');
      const res = await updateSnapshot(context, info);
      assert.strictEqual(res.status, 404);
    });

    it('returns 409 when snapshot is locked', async () => {
      manifestNock(nock, LOCKED_MANIFEST);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome', 'POST');
      const res = await updateSnapshot(context, info);
      assert.strictEqual(res.status, 409);
    });

    it('registers resource already in snapshot folder without copying', async () => {
      manifestNock(nock, EXISTING_MANIFEST);
      // path is /.snapshots/test-snap/doc — already inside the snapshot
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/.snapshots/test-snap/doc', 'POST');
      const res = await updateSnapshot(context, info);
      assert.strictEqual(res.status, 200);
    });

    it('records 404 when source does not exist', async () => {
      manifestNock(nock, null);
      nock.content().headObject('/preview/missing.md').reply(404);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/missing', 'POST');
      const res = await updateSnapshot(context, info);
      assert.strictEqual(res.status, 204);
    });

    it('reads from live partition when fromLive is true', async () => {
      const fromLiveManifest = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        fromLive: true,
        resources: [],
      };
      manifestNock(nock, fromLiveManifest);
      // HEAD goes to live partition, not preview
      nock.content().headObject('/live/doc.md').reply(404);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/doc', 'POST');
      const res = await updateSnapshot(context, info);
      assert.strictEqual(res.status, 204);
    });

    it('copies from live with x-last-published metadata when fromLive is true', async () => {
      const fromLiveManifest = {
        id: 'test-snap',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
        fromLive: true,
        resources: [],
      };
      manifestNock(nock, fromLiveManifest);
      // HEAD on live partition: once for updateSnapshot check, once for copy internals
      nock.content()
        .headObject('/live/doc.md')
        .times(2)
        .reply(200, '', { 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' })
        // copy from live to snapshot
        .copyObject('/preview/.snapshots/test-snap/doc.md')
        .reply(
          200,
          '<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>"abc"</ETag></CopyObjectResult>',
        );
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/doc', 'POST');
      const res = await updateSnapshot(context, info);
      assert.strictEqual(res.status, 200);
    });

    it('removes old copy when source disappears for existing resource', async () => {
      manifestNock(nock, EXISTING_MANIFEST);
      nock.content()
        .headObject('/preview/welcome.md').reply(404)
        .deleteObject('/preview/.snapshots/test-snap/welcome.md')
        .reply(204);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome', 'POST');
      const res = await updateSnapshot(context, info);
      assert.strictEqual(res.status, 204);
    });
  });

  describe('publishSnapshot()', () => {
    it('returns 404 when resource not in manifest', async () => {
      manifestNock(nock, EXISTING_MANIFEST);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/unknown', 'POST');
      const res = await publishSnapshot(context, info);
      assert.strictEqual(res.status, 404);
    });

    it('removes from live when resource status is STATUS_DELETED', async () => {
      manifestNock(nock, EXISTING_MANIFEST);
      nock.content().deleteObject('/live/deleted.md').reply(204);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/deleted', 'POST');
      const res = await publishSnapshot(context, info);
      assert.strictEqual(res.status, 200);
    });

    // Note: copy-to-live path is tested via SnapshotJob integration tests
    // Direct nock-based copy testing is unreliable due to S3 SDK internal HEAD calls
  });

  describe('removeSnapshot()', () => {
    it('returns 404 when manifest does not exist', async () => {
      manifestNock(nock, null);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome', 'DELETE');
      const res = await removeSnapshot(context, info);
      assert.strictEqual(res.status, 404);
    });

    it('returns 409 when snapshot is locked', async () => {
      manifestNock(nock, LOCKED_MANIFEST);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome', 'DELETE');
      const res = await removeSnapshot(context, info);
      assert.strictEqual(res.status, 409);
    });

    it('returns 204 for STATUS_DELETED resource (no storage delete needed)', async () => {
      manifestNock(nock, EXISTING_MANIFEST);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/deleted', 'DELETE');
      const res = await removeSnapshot(context, info);
      assert.strictEqual(res.status, 204);
    });

    it('returns 404 when resource not in storage', async () => {
      manifestNock(nock, EXISTING_MANIFEST);
      nock.content()
        .headObject('/preview/.snapshots/test-snap/welcome.md')
        .reply(404);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome', 'DELETE');
      const res = await removeSnapshot(context, info);
      assert.strictEqual(res.status, 404);
    });

    it('deletes resource from storage', async () => {
      manifestNock(nock, EXISTING_MANIFEST);
      nock.content()
        .headObject('/preview/.snapshots/test-snap/welcome.md')
        .reply(200, '', { 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' })
        .deleteObject('/preview/.snapshots/test-snap/welcome.md')
        .reply(204);
      const { context, info } = createRequest('/org/sites/site/snapshots/test-snap/welcome', 'DELETE');
      const res = await removeSnapshot(context, info);
      assert.strictEqual(res.status, 204);
    });
  });
});
