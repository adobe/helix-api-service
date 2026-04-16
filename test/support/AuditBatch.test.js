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
import { AuthInfo } from '../../src/auth/AuthInfo.js';
import { Manifest } from '../../src/snapshot/Manifest.js';
import { shouldAudit, createNotification } from '../../src/support/AuditBatch.js';
import { createContext, createInfo, SITE_CONFIG } from '../utils.js';

describe('AuditBatch Tests', () => {
  function setupTest({
    suffix = '/org/sites/site/status/',
    headers = {},
    method = 'POST',
    attributes = {},
    data = {},
    env = {},
  } = {}) {
    return {
      context: createContext(suffix, { attributes, data, env }),
      info: createInfo(suffix, headers, method),
    };
  }

  describe('shouldAudit', () => {
    it('returns `false` if the route is `log`', () => {
      const { context, info } = setupTest({
        suffix: '/org/sites/site/log',
      });

      const flag = shouldAudit(context, info, new Response());
      assert.strictEqual(flag, false);
    });

    it('returns `false` if the method is not POST, DELETE, or PUT', () => {
      const { context, info } = setupTest({
        method: 'GET',
      });

      const flag = shouldAudit(context, info, new Response());
      assert.strictEqual(flag, false);
    });

    it('returns `true` if there are errors', () => {
      const { context, info } = setupTest({
        attributes: {
          errors: ['error'],
        },
      });

      const flag = shouldAudit(context, info, new Response());
      assert.strictEqual(flag, true);
    });

    it('returns `true` if there is a parent invocation', () => {
      const { context, info } = setupTest({
        headers: {
          'x-parent-invocation-id': 'invocation-id',
        },
      });

      const flag = shouldAudit(context, info, new Response());
      assert.strictEqual(flag, true);
    });

    it('returns `true` if the response is OK', () => {
      const { context, info } = setupTest();

      const flag = shouldAudit(context, info, new Response());
      assert.strictEqual(flag, true);
    });

    it('returns `false` if the status is not 429 or >= 500', () => {
      const { context, info } = setupTest();

      const flag = shouldAudit(context, info, new Response('', { status: 400 }));
      assert.strictEqual(flag, false);
    });

    [undefined, 'not a json string', '["org1","org2"]'].forEach((json) => {
      it(`returns \`false\` if audit log failures is: ${json}`, () => {
        const { context, info } = setupTest({
          env: {
            HLX_AUDIT_LOG_FAILURES: json,
          },
        });
        const flag = shouldAudit(context, info, new Response('', { status: 500 }));
        assert.strictEqual(flag, false);
      });
    });

    it('returns true if org is in the audit log failures list', () => {
      const { context, info } = setupTest({
        env: {
          HLX_AUDIT_LOG_FAILURES: '["org"]',
        },
      });
      const flag = shouldAudit(context, info, new Response('', { status: 500 }));
      assert.strictEqual(flag, true);
    });
  });

  describe('createNotification', () => {
    it('returns `null` if the response is not OK and audit should not be logged', async () => {
      const { context, info } = setupTest();

      const notification = await createNotification(context, info, {
        res: new Response('', { status: 500 }),
      });
      assert.strictEqual(notification, null);
    });

    it('returns `null` if there is no content bus ID', async () => {
      const { context, info } = setupTest({
        attributes: {
          config: null,
        },
      });

      const notification = await createNotification(context, info, {
        res: new Response(),
      });
      assert.strictEqual(notification, null);
    });

    it('returns notification with default properties', async () => {
      const { context, info } = setupTest();

      const notification = await createNotification(context, info, {
        res: new Response(),
        start: 0,
        stop: 1,
      });
      assert.deepStrictEqual(notification, {
        contentBusId: SITE_CONFIG.content.contentBusId,
        duration: 1,
        method: 'POST',
        route: 'status',
        path: '/',
        status: 200,
        timestamp: 0,
      });
    });

    it('returns notification with error', async () => {
      const manifest = new Manifest();
      manifest.id = 'test-snap';
      manifest.addResource('/documents/doc1', Manifest.STATUS_EXISTS);

      const { context, info } = setupTest({
        headers: {
          'x-forwarded-for': '127.0.0.1',
        },
        attributes: {
          authInfo: AuthInfo.Admin().withProfile({ email: 'admin@example.com' }),
          details: ['detail1', 'detail2'],
          errors: ['error1', 'error2'],
          snapshotManifest: manifest,
        },
        data: {
          paths: ['/path1', '/path2'],
        },
      });

      const notification = await createNotification(context, info, {
        res: new Response('', { headers: { 'x-error': 'error' } }),
        start: 0,
        stop: 1,
        url: new URL('https://example.com/path1?query=value'),
      });
      assert.deepStrictEqual(notification, {
        contentBusId: SITE_CONFIG.content.contentBusId,
        details: ['detail1', 'detail2'],
        duration: 1,
        error: 'error',
        errors: ['error1', 'error2'],
        ip: '127.0.0.1',
        method: 'POST',
        paths: ['/path1', '/path2'],
        route: 'status',
        path: '/',
        resources: [{
          path: '/documents/doc1',
          status: Manifest.STATUS_EXISTS,
        }],
        search: '?query=value',
        snapshotId: 'test-snap',
        status: 200,
        timestamp: 0,
        user: 'admin@example.com',
      });
    });
  });
});
