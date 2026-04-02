/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { Resource } from '../../src/job/Resource.js';
import { PublishResource } from '../../src/live/PublishResource.js';
import { PreviewResource } from '../../src/preview/PreviewResource.js';
import { RemoveResource } from '../../src/preview/RemoveResource.js';
import { CodeResource } from '../../src/code/CodeResource.js';

describe('Resource', () => {
  describe('base class', () => {
    it('constructs with resourcePath', () => {
      const r = new Resource('/doc.md');
      assert.strictEqual(r.resourcePath, '/doc.md');
      assert.strictEqual(r.status, undefined);
      assert.strictEqual(r.error, undefined);
    });

    it('setStatus sets status and optional error', () => {
      const r = new Resource('/doc.md');
      r.setStatus(200);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.error, undefined);

      r.setStatus(500, 'internal error');
      assert.strictEqual(r.status, 500);
      assert.strictEqual(r.error, 'internal error');
    });

    it('isProcessed returns false before status set', () => {
      const r = new Resource('/doc.md');
      assert.strictEqual(r.isProcessed(), false);
    });

    it('isProcessed returns true once status is set', () => {
      const r = new Resource('/doc.md');
      r.setStatus(200);
      assert.strictEqual(r.isProcessed(), true);
    });

    it('isProcessed returns true for status 0', () => {
      const r = new Resource('/doc.md');
      r.status = 0;
      // base class: status !== undefined → true
      assert.strictEqual(r.isProcessed(), true);
    });

    it('toJSON omits undefined fields', () => {
      const r = new Resource('/doc.md');
      assert.deepStrictEqual(r.toJSON(), { resourcePath: '/doc.md' });
    });

    it('toJSON includes status and error when set', () => {
      const r = new Resource('/doc.md');
      r.setStatus(404, 'not found');
      assert.deepStrictEqual(r.toJSON(), { resourcePath: '/doc.md', status: 404, error: 'not found' });
    });

    it('fromJSON round-trips through JSON.stringify', () => {
      const r = new Resource('/doc.md');
      r.setStatus(200);
      const json = JSON.stringify(r);
      const r2 = Resource.fromJSON(JSON.parse(json));
      assert.strictEqual(r2.resourcePath, '/doc.md');
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.error, undefined);
    });

    it('fromJSON restores error field', () => {
      const r = Resource.fromJSON({ resourcePath: '/doc.md', status: 500, error: 'oops' });
      assert.strictEqual(r.error, 'oops');
    });

    it('fromJSONArray deserializes an array of plain objects', () => {
      const objs = [{ resourcePath: '/a.md', status: 200 }, { resourcePath: '/b.md' }];
      const [a, b] = Resource.fromJSONArray(objs);
      assert.strictEqual(a.resourcePath, '/a.md');
      assert.strictEqual(a.status, 200);
      assert.strictEqual(b.resourcePath, '/b.md');
    });

    it('fromJSONArray returns empty array for undefined', () => {
      assert.deepStrictEqual(Resource.fromJSONArray(undefined), []);
    });

    it('toJSONArray serializes an array of resources', () => {
      const r = new Resource('/doc.md');
      r.setStatus(200);
      assert.deepStrictEqual(Resource.toJSONArray([r]), [{ resourcePath: '/doc.md', status: 200 }]);
    });
  });

  describe('PublishResource', () => {
    it('constructs with resourcePath and path', () => {
      const r = new PublishResource('/doc.md', '/doc');
      assert.strictEqual(r.resourcePath, '/doc.md');
      assert.strictEqual(r.path, '/doc');
    });

    describe('fromJSON / toJSON round-trip', () => {
      it('coerces lastModified string to Date', () => {
        const date = new Date('2025-01-01T00:00:00.000Z');
        const r = new PublishResource('/doc.md', '/doc');
        r.lastModified = date;
        const json = JSON.stringify(r);
        const r2 = PublishResource.fromJSON(JSON.parse(json));
        assert.ok(r2.lastModified instanceof Date, 'lastModified should be a Date');
        assert.strictEqual(r2.lastModified.getTime(), date.getTime());
      });

      it('preserves all boolean flags', () => {
        const r = new PublishResource('/metadata.json', '/metadata');
        r.metadata = true;
        r.redirects = true;
        r.setStatus(200);
        r.setPurged();
        r.setIndexed();
        r.setNotified();
        const r2 = PublishResource.fromJSON(JSON.parse(JSON.stringify(r)));
        assert.strictEqual(r2.metadata, true);
        assert.strictEqual(r2.redirects, true);
        assert.strictEqual(r2.purged, true);
        assert.strictEqual(r2.indexed, true);
        assert.strictEqual(r2.notified, true);
        assert.strictEqual(r2.status, 200);
      });

      it('omits false/undefined boolean flags from JSON', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setStatus(200);
        const obj = r.toJSON();
        assert.strictEqual(obj.purged, undefined);
        assert.strictEqual(obj.indexed, undefined);
        assert.strictEqual(obj.notified, undefined);
        assert.strictEqual(obj.metadata, undefined);
        assert.strictEqual(obj.redirects, undefined);
      });

      it('omits lastModified when not set', () => {
        const r = new PublishResource('/doc.md', '/doc');
        assert.strictEqual(r.toJSON().lastModified, undefined);
      });
    });

    describe('state transitions', () => {
      it('setNotModified sets status to 304', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setNotModified();
        assert.strictEqual(r.status, 304);
      });

      it('setPurged sets purged to true', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setPurged();
        assert.strictEqual(r.purged, true);
      });

      it('setIndexed sets indexed to true', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setIndexed();
        assert.strictEqual(r.indexed, true);
      });

      it('setNotified sets notified to true', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setNotified();
        assert.strictEqual(r.notified, true);
      });
    });

    describe('predicates', () => {
      it('needsPurging: true when not purged and status !== 304', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setStatus(200);
        assert.strictEqual(r.needsPurging(), true);
      });

      it('needsPurging: false when already purged', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setStatus(200);
        r.setPurged();
        assert.strictEqual(r.needsPurging(), false);
      });

      it('needsPurging: false for 304', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setNotModified();
        assert.strictEqual(r.needsPurging(), false);
      });

      it('needsIndexing: true when purged but not indexed and status !== 304', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setStatus(200);
        r.setPurged();
        assert.strictEqual(r.needsIndexing(), true);
      });

      it('needsIndexing: false when not purged', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setStatus(200);
        assert.strictEqual(r.needsIndexing(), false);
      });

      it('needsIndexing: false when already indexed', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setStatus(200);
        r.setPurged();
        r.setIndexed();
        assert.strictEqual(r.needsIndexing(), false);
      });

      it('needsIndexing: false for 304', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setNotModified();
        r.setPurged();
        assert.strictEqual(r.needsIndexing(), false);
      });

      it('needsNotification: true when not notified and status !== 304', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setStatus(200);
        assert.strictEqual(r.needsNotification(), true);
      });

      it('needsNotification: false for 304', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setNotModified();
        assert.strictEqual(r.needsNotification(), false);
      });

      it('needsNotification: false when already notified', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setStatus(200);
        r.setNotified();
        assert.strictEqual(r.needsNotification(), false);
      });

      it('isPublished: true when purged and indexed', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setStatus(200);
        r.setPurged();
        r.setIndexed();
        assert.strictEqual(r.isPublished(), true);
      });

      it('isPublished: false when only purged', () => {
        const r = new PublishResource('/doc.md', '/doc');
        r.setStatus(200);
        r.setPurged();
        assert.strictEqual(r.isPublished(), false);
      });
    });
  });

  describe('PreviewResource', () => {
    it('constructs with resourcePath, path, source', () => {
      const source = { lastModified: 1234567890, type: 'markup' };
      const r = new PreviewResource('/doc.md', '/doc', source);
      assert.strictEqual(r.resourcePath, '/doc.md');
      assert.strictEqual(r.path, '/doc');
      assert.deepStrictEqual(r.source, source);
    });

    it('isProcessed returns false when status is undefined', () => {
      const r = new PreviewResource('/doc.md', '/doc');
      assert.strictEqual(r.isProcessed(), false);
    });

    it('isProcessed returns false when status is 0 (not-started sentinel)', () => {
      const r = new PreviewResource('/doc.md', '/doc');
      r.status = 0;
      assert.strictEqual(r.isProcessed(), false);
    });

    it('isProcessed returns true once status is non-zero', () => {
      const r = new PreviewResource('/doc.md', '/doc');
      r.setStatus(200);
      assert.strictEqual(r.isProcessed(), true);
    });

    it('setError sets error and errorCode', () => {
      const r = new PreviewResource('/doc.md', '/doc');
      r.setError('something went wrong', 'ERR_CODE');
      assert.strictEqual(r.error, 'something went wrong');
      assert.strictEqual(r.errorCode, 'ERR_CODE');
    });

    it('setError without errorCode leaves errorCode undefined', () => {
      const r = new PreviewResource('/doc.md', '/doc');
      r.setError('oops');
      assert.strictEqual(r.error, 'oops');
      assert.strictEqual(r.errorCode, undefined);
    });

    it('fromJSON round-trips source and redirects', () => {
      const source = { lastModified: 1234567890, type: 'markup' };
      const r = new PreviewResource('/redirects.json', '/redirects', source);
      r.redirects = true;
      r.setStatus(200);
      const r2 = PreviewResource.fromJSON(JSON.parse(JSON.stringify(r)));
      assert.deepStrictEqual(r2.source, source);
      assert.strictEqual(r2.redirects, true);
      assert.strictEqual(r2.status, 200);
    });

    it('fromJSON round-trips errorCode', () => {
      const r = new PreviewResource('/doc.md', '/doc');
      r.setError('bad request', 'ERR_400');
      r.setStatus(400);
      const r2 = PreviewResource.fromJSON(JSON.parse(JSON.stringify(r)));
      assert.strictEqual(r2.errorCode, 'ERR_400');
      assert.strictEqual(r2.error, 'bad request');
    });

    it('fromJSON from handler list output (no status)', () => {
      // simulate what handler.list() returns
      const file = { resourcePath: '/doc.md', path: '/doc', source: { lastModified: 999, type: 'markup' } };
      const r = PreviewResource.fromJSON(file);
      assert.strictEqual(r.resourcePath, '/doc.md');
      assert.strictEqual(r.status, undefined);
      assert.strictEqual(r.isProcessed(), false);
    });
  });

  describe('RemoveResource', () => {
    it('constructs with resourcePath, path, lastModified', () => {
      const date = new Date('2025-06-01T00:00:00.000Z');
      const r = new RemoveResource('/doc.md', '/doc', date);
      assert.strictEqual(r.resourcePath, '/doc.md');
      assert.strictEqual(r.path, '/doc');
      assert.ok(r.lastModified instanceof Date);
      assert.strictEqual(r.lastModified.getTime(), date.getTime());
    });

    it('fromJSON coerces lastModified string to Date', () => {
      const date = new Date('2025-06-01T00:00:00.000Z');
      const r = new RemoveResource('/doc.md', '/doc', date);
      const r2 = RemoveResource.fromJSON(JSON.parse(JSON.stringify(r)));
      assert.ok(r2.lastModified instanceof Date);
      assert.strictEqual(r2.lastModified.getTime(), date.getTime());
    });

    it('isDeleted returns true for status 204', () => {
      const r = new RemoveResource('/doc.md', '/doc');
      r.setStatus(204);
      assert.strictEqual(r.isDeleted(), true);
    });

    it('isDeleted returns false for other statuses', () => {
      const r = new RemoveResource('/doc.md', '/doc');
      r.setStatus(404);
      assert.strictEqual(r.isDeleted(), false);
    });

    it('isDeleted returns false when not yet processed', () => {
      const r = new RemoveResource('/doc.md', '/doc');
      assert.strictEqual(r.isDeleted(), false);
    });
  });

  describe('CodeResource', () => {
    describe('fromChange', () => {
      it('creates resource from a modified change', () => {
        const change = {
          path: 'scripts/main.js',
          type: 'modified',
          lastModified: 'Thu, 01 Jan 2026 00:00:00 GMT',
          contentType: 'text/javascript; charset=utf-8',
          contentLength: 1024,
        };
        const r = CodeResource.fromChange(change);
        assert.strictEqual(r.resourcePath, '/scripts/main.js');
        assert.strictEqual(r.status, 200);
        assert.ok(r.lastModified instanceof Date);
        assert.strictEqual(r.lastModified.toUTCString(), 'Thu, 01 Jan 2026 00:00:00 GMT');
        assert.strictEqual(r.contentType, 'text/javascript; charset=utf-8');
        assert.strictEqual(r.contentLength, 1024);
        assert.strictEqual(r.deleted, undefined);
      });

      it('creates resource from a deleted change', () => {
        const change = { path: 'old/file.js', type: 'deleted' };
        const r = CodeResource.fromChange(change, 204);
        assert.strictEqual(r.resourcePath, '/old/file.js');
        assert.strictEqual(r.status, 204);
        assert.strictEqual(r.deleted, true);
        assert.strictEqual(r.lastModified, undefined);
        assert.strictEqual(r.contentType, undefined);
      });

      it('records error message', () => {
        const change = { path: 'file.js', type: 'modified' };
        const r = CodeResource.fromChange(change, 500, 'upload failed');
        assert.strictEqual(r.status, 500);
        assert.strictEqual(r.error, 'upload failed');
      });
    });

    it('isSuccess returns true for 200 and 204', () => {
      const r200 = CodeResource.fromChange({ path: 'f.js', type: 'modified' }, 200);
      const r204 = CodeResource.fromChange({ path: 'f.js', type: 'deleted' }, 204);
      assert.strictEqual(r200.isSuccess(), true);
      assert.strictEqual(r204.isSuccess(), true);
    });

    it('isSuccess returns false for 4xx/5xx', () => {
      const r = CodeResource.fromChange({ path: 'f.js', type: 'modified' }, 404);
      assert.strictEqual(r.isSuccess(), false);
    });

    it('fromJSON / toJSON round-trips contentLength', () => {
      const change = {
        path: 'scripts/main.js',
        type: 'modified',
        contentType: 'text/javascript',
        contentLength: 2048,
      };
      const r = CodeResource.fromChange(change);
      const r2 = CodeResource.fromJSON(JSON.parse(JSON.stringify(r)));
      assert.strictEqual(r2.contentLength, 2048);
      assert.strictEqual(r2.contentType, 'text/javascript');
    });

    it('lastModified round-trips as Date through JSON', () => {
      const change = {
        path: 'f.js',
        type: 'modified',
        lastModified: 'Thu, 01 Jan 2026 00:00:00 GMT',
        contentType: 'application/javascript',
      };
      const r = CodeResource.fromChange(change);
      const r2 = CodeResource.fromJSON(JSON.parse(JSON.stringify(r)));
      assert.ok(r2.lastModified instanceof Date);
      assert.strictEqual(r2.lastModified.toUTCString(), 'Thu, 01 Jan 2026 00:00:00 GMT');
    });

    it('fromJSON round-trips deleted resource', () => {
      const r = CodeResource.fromChange({ path: 'old.js', type: 'deleted' }, 204);
      const r2 = CodeResource.fromJSON(JSON.parse(JSON.stringify(r)));
      assert.strictEqual(r2.deleted, true);
      assert.strictEqual(r2.status, 204);
      assert.strictEqual(r2.lastModified, undefined);
    });
  });
});
