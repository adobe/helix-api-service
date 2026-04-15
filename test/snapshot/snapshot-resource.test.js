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
import { SnapshotResource } from '../../src/snapshot/SnapshotResource.js';

describe('SnapshotResource Tests', () => {
  describe('constructor', () => {
    it('sets resourcePath and webPath', () => {
      const r = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      assert.strictEqual(r.resourcePath, '/documents/doc1.md');
      assert.strictEqual(r.webPath, '/documents/doc1');
      assert.strictEqual(r.status, undefined);
      assert.strictEqual(r.error, undefined);
      assert.strictEqual(r.lastModified, undefined);
    });
  });

  describe('fromJSON', () => {
    it('deserializes all fields from a plain object', () => {
      const now = new Date('2025-06-01T12:00:00.000Z');
      const obj = {
        resourcePath: '/documents/doc1.md',
        webPath: '/documents/doc1',
        status: 200,
        error: 'some error',
        lastModified: now.toISOString(),
      };

      const r = SnapshotResource.fromJSON(obj);
      assert.ok(r instanceof SnapshotResource);
      assert.strictEqual(r.resourcePath, '/documents/doc1.md');
      assert.strictEqual(r.webPath, '/documents/doc1');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.error, 'some error');
      assert.strictEqual(r.lastModified.toISOString(), now.toISOString());
    });

    it('handles minimal object without optional fields', () => {
      const r = SnapshotResource.fromJSON({ resourcePath: '/foo.md' });
      assert.strictEqual(r.resourcePath, '/foo.md');
      assert.strictEqual(r.webPath, undefined);
      assert.strictEqual(r.status, undefined);
      assert.strictEqual(r.error, undefined);
      assert.strictEqual(r.lastModified, undefined);
    });
  });

  describe('toJSON', () => {
    it('serializes all fields including webPath', () => {
      const r = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      r.setStatus(200);
      r.setLastModified(new Date('2025-06-01T12:00:00.000Z'));

      const json = r.toJSON();
      assert.deepStrictEqual(json, {
        resourcePath: '/documents/doc1.md',
        webPath: '/documents/doc1',
        status: 200,
        lastModified: '2025-06-01T12:00:00.000Z',
      });
    });

    it('omits undefined optional fields', () => {
      const r = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      const json = r.toJSON();
      assert.deepStrictEqual(json, {
        resourcePath: '/documents/doc1.md',
        webPath: '/documents/doc1',
      });
    });

    it('includes error when set', () => {
      const r = new SnapshotResource('/documents/doc1.md', '/documents/doc1');
      r.setStatus(500, 'server error');
      const json = r.toJSON();
      assert.strictEqual(json.error, 'server error');
      assert.strictEqual(json.status, 500);
    });
  });

  describe('fromJSONArray', () => {
    it('round-trips an array of resources', () => {
      const resources = [
        new SnapshotResource('/documents/doc1.md', '/documents/doc1'),
        new SnapshotResource('/images/hero.png', '/images/hero.png'),
      ];
      resources[0].setStatus(200);
      resources[0].setLastModified(new Date('2025-01-01T00:00:00.000Z'));
      resources[1].setStatus(404);

      const serialized = resources.map((r) => r.toJSON());
      const deserialized = SnapshotResource.fromJSONArray(serialized);

      assert.strictEqual(deserialized.length, 2);
      assert.ok(deserialized[0] instanceof SnapshotResource);
      assert.ok(deserialized[1] instanceof SnapshotResource);
      assert.strictEqual(deserialized[0].resourcePath, '/documents/doc1.md');
      assert.strictEqual(deserialized[0].webPath, '/documents/doc1');
      assert.strictEqual(deserialized[0].status, 200);
      assert.strictEqual(deserialized[0].lastModified.toISOString(), '2025-01-01T00:00:00.000Z');
      assert.strictEqual(deserialized[1].resourcePath, '/images/hero.png');
      assert.strictEqual(deserialized[1].webPath, '/images/hero.png');
      assert.strictEqual(deserialized[1].status, 404);
    });

    it('returns empty array for null/undefined input', () => {
      assert.deepStrictEqual(SnapshotResource.fromJSONArray(null), []);
      assert.deepStrictEqual(SnapshotResource.fromJSONArray(undefined), []);
    });
  });

  describe('inherited methods', () => {
    it('setStatus sets status and optional error', () => {
      const r = new SnapshotResource('/doc.md', '/doc');
      r.setStatus(200);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.error, undefined);

      r.setStatus(500, 'internal error');
      assert.strictEqual(r.status, 500);
      assert.strictEqual(r.error, 'internal error');
    });

    it('setLastModified coerces string to Date', () => {
      const r = new SnapshotResource('/doc.md', '/doc');
      r.setLastModified('2025-06-15T10:30:00.000Z');
      assert.ok(r.lastModified instanceof Date);
      assert.strictEqual(r.lastModified.toISOString(), '2025-06-15T10:30:00.000Z');
    });

    it('setLastModified ignores falsy values', () => {
      const r = new SnapshotResource('/doc.md', '/doc');
      r.setLastModified(null);
      assert.strictEqual(r.lastModified, undefined);
      r.setLastModified(undefined);
      assert.strictEqual(r.lastModified, undefined);
    });

    it('isProcessed returns false before status is set, true after', () => {
      const r = new SnapshotResource('/doc.md', '/doc');
      assert.strictEqual(r.isProcessed(), false);
      r.setStatus(200);
      assert.strictEqual(r.isProcessed(), true);
    });
  });
});
