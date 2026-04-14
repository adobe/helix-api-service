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
import { Manifest } from '../../src/snapshot/Manifest.js';
import {
  createContext, createInfo, Nock, SITE_CONFIG,
} from '../utils.js';

function createTestContext(data = {}) {
  return createContext('/org/sites/site/snapshots/test-snap', {
    env: { HELIX_STORAGE_DISABLE_R2: 'true' },
    attributes: {
      config: structuredClone(SITE_CONFIG),
    },
    data,
  });
}

describe('Manifest Tests', () => {
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('creates new manifest when none exists', async () => {
    nock.content().getObject('/preview/.snapshots/test-snap/.manifest.json').reply(404, '');
    const context = createTestContext();
    const manifest = await Manifest.fromContext(context, 'test-snap');
    assert.strictEqual(manifest.id, 'test-snap');
    assert.strictEqual(manifest.exists, false);
    assert.strictEqual(manifest.resources.size, 0);
  });

  it('loads existing manifest', async () => {
    const manifestData = {
      id: 'test-snap',
      created: '2025-01-01T00:00:00Z',
      lastModified: '2025-01-01T00:00:00Z',
      title: 'Test',
      resources: [
        { path: '/welcome', status: 200 },
        { path: '/old-page', status: 404 },
      ],
    };
    nock.content().getObject('/preview/.snapshots/test-snap/.manifest.json').reply(200, JSON.stringify(manifestData));
    const context = createTestContext();
    const manifest = await Manifest.fromContext(context, 'test-snap');
    assert.strictEqual(manifest.exists, true);
    assert.strictEqual(manifest.title, 'Test');
    assert.strictEqual(manifest.resources.size, 2);
    assert.strictEqual(manifest.resources.get('/welcome').status, 200);
    assert.strictEqual(manifest.resources.get('/old-page').status, 404);
  });

  it('returns cached manifest on second call', async () => {
    nock.content().getObject('/preview/.snapshots/test-snap/.manifest.json').reply(404, '');
    const context = createTestContext();
    const m1 = await Manifest.fromContext(context, 'test-snap');
    const m2 = await Manifest.fromContext(context, 'test-snap');
    assert.strictEqual(m1, m2);
  });

  it('sets fromLive when context data has fromLive=true', async () => {
    nock.content().getObject('/preview/.snapshots/test-snap/.manifest.json').reply(404, '');
    const context = createTestContext({ fromLive: true });
    const manifest = await Manifest.fromContext(context, 'test-snap');
    assert.strictEqual(manifest.fromLive, true);
  });

  it('addResource adds new resource', () => {
    const manifest = new Manifest();
    manifest.addResource('/foo', 200);
    assert.strictEqual(manifest.resources.size, 1);
    assert.strictEqual(manifest.resources.get('/foo').status, 200);
  });

  it('addResource updates existing resource status', () => {
    const manifest = new Manifest();
    manifest.addResource('/foo', 200);
    manifest.addResource('/foo', 404);
    assert.strictEqual(manifest.resources.get('/foo').status, 404);
    assert.strictEqual(manifest.resourcesNeedPurge, true);
  });

  it('removeResource removes from manifest', () => {
    const manifest = new Manifest();
    manifest.addResource('/foo', 200);
    manifest.removeResource('/foo');
    assert.strictEqual(manifest.resources.size, 0);
    assert.strictEqual(manifest.resourcesNeedPurge, true);
  });

  it('removeResource with forcePurge on non-existing', () => {
    const manifest = new Manifest();
    manifest.removeResource('/foo', true);
    assert.strictEqual(manifest.resources.size, 0);
    assert.strictEqual(manifest.resourcesNeedPurge, true);
  });

  it('lock and unlock', () => {
    const manifest = new Manifest();
    assert.strictEqual(manifest.lock(true), true);
    assert.ok(manifest.locked);
    assert.strictEqual(manifest.lock(true), false); // already locked
    assert.strictEqual(manifest.lock(false), true);
    assert.strictEqual(manifest.locked, undefined);
  });

  it('setProperty sets title', () => {
    const manifest = new Manifest();
    manifest.setProperty('title', 'My Title');
    assert.strictEqual(manifest.title, 'My Title');
  });

  it('setProperty rejects unsupported property', () => {
    const manifest = new Manifest();
    assert.throws(() => manifest.setProperty('unsupported', 'value'), /setting unsupported is not supported/);
  });

  it('setProperty rejects exceeding limit', () => {
    const manifest = new Manifest();
    assert.throws(() => manifest.setProperty('title', 'x'.repeat(5000)), /property "title" exceeds 4kb limit/);
  });

  it('setProperty removes property when value is falsy', () => {
    const manifest = new Manifest();
    manifest.setProperty('title', 'My Title');
    manifest.setProperty('title', '');
    assert.strictEqual(manifest.title, undefined);
  });

  it('setReviewState sets review', () => {
    const manifest = new Manifest();
    manifest.setReviewState('requested');
    assert.strictEqual(manifest.review, 'requested');
  });

  it('markResourceUpdated sets lastUpdated', () => {
    const manifest = new Manifest();
    manifest.markResourceUpdated();
    assert.ok(manifest.lastUpdated);
    assert.ok(manifest.lastModified);
  });

  it('markResourcesPurged clears purge set', () => {
    const manifest = new Manifest();
    manifest.addResource('/foo', 200);
    manifest.addResource('/foo', 404); // triggers purge
    assert.strictEqual(manifest.resourcesNeedPurge, true);
    manifest.markResourcesPurged();
    assert.strictEqual(manifest.resourcesNeedPurge, false);
  });

  it('resourcesToPurge includes snapshot prefix', () => {
    const manifest = new Manifest();
    manifest.id = 'snap1';
    manifest.addResource('/foo', 200);
    manifest.addResource('/foo', 404);
    const paths = manifest.resourcesToPurge;
    assert.deepStrictEqual(paths, ['/.snapshots/snap1/foo']);
  });

  it('toJSON serializes correctly', () => {
    const manifest = new Manifest();
    manifest.id = 'snap1';
    manifest.created = '2025-01-01T00:00:00Z';
    manifest.lastModified = '2025-01-01T00:00:00Z';
    manifest.title = 'Test';
    manifest.addResource('/b', 200);
    manifest.addResource('/a', 404);
    const json = manifest.toJSON();
    assert.strictEqual(json.id, 'snap1');
    assert.strictEqual(json.title, 'Test');
    // resources sorted alphabetically
    assert.strictEqual(json.resources[0].path, '/a');
    assert.strictEqual(json.resources[1].path, '/b');
  });

  it('toResponse returns JSON response with links', () => {
    const manifest = new Manifest();
    manifest.id = 'snap1';
    manifest.created = '2025-01-01T00:00:00Z';
    const info = createInfo('/org/sites/site/snapshots/snap1');
    const response = manifest.toResponse(info);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'application/json');
  });

  it('store creates new manifest', async () => {
    nock.content().getObject('/preview/.snapshots/test-snap/.manifest.json').reply(404, '');
    nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
    const context = createTestContext();
    const manifest = await Manifest.fromContext(context, 'test-snap');
    manifest.addResource('/foo', 200);
    const needsPurge = await manifest.store();
    assert.strictEqual(needsPurge, true); // addResource called touch() which sets isModified
    assert.strictEqual(manifest.exists, true);
    assert.ok(manifest.created);
  });

  it('store returns true when modified', async () => {
    const manifestData = {
      id: 'test-snap',
      created: '2025-01-01T00:00:00Z',
      lastModified: '2025-01-01T00:00:00Z',
      resources: [],
    };
    nock.content().getObject('/preview/.snapshots/test-snap/.manifest.json').reply(200, JSON.stringify(manifestData));
    nock.content().putObject('/preview/.snapshots/test-snap/.manifest.json').reply(200);
    const context = createTestContext();
    const manifest = await Manifest.fromContext(context, 'test-snap');
    manifest.addResource('/foo', 200);
    const needsPurge = await manifest.store();
    assert.strictEqual(needsPurge, true);
  });

  it('store does not write when unmodified', async () => {
    const manifestData = {
      id: 'test-snap',
      created: '2025-01-01T00:00:00Z',
      lastModified: '2025-01-01T00:00:00Z',
      resources: [],
    };
    nock.content().getObject('/preview/.snapshots/test-snap/.manifest.json').reply(200, JSON.stringify(manifestData));
    const context = createTestContext();
    const manifest = await Manifest.fromContext(context, 'test-snap');
    const needsPurge = await manifest.store();
    assert.strictEqual(needsPurge, false);
  });

  it('delete removes manifest', async () => {
    const manifestData = {
      id: 'test-snap',
      created: '2025-01-01T00:00:00Z',
      lastModified: '2025-01-01T00:00:00Z',
      resources: [],
    };
    nock.content().getObject('/preview/.snapshots/test-snap/.manifest.json').reply(200, JSON.stringify(manifestData));
    nock.content().deleteObject('/preview/.snapshots/test-snap/.manifest.json').reply(204);
    const context = createTestContext();
    const manifest = await Manifest.fromContext(context, 'test-snap');
    await manifest.delete();
    assert.strictEqual(manifest.exists, false);
  });
});
