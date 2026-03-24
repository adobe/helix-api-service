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
import {
  NotificationsSupport,
  getNotifier,
  publishBulkResourceNotification,
  splitArray,
} from '../../src/support/notifications.js';
import { createContext, Nock } from '../utils.js';

describe('Notifications Test', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock({ disableAudit: true }).env();
  });

  afterEach(() => {
    nock.done();
  });

  it('uses existing notifier', async () => {
    const context = createContext();
    const notifier = getNotifier(context);
    assert.strictEqual(notifier, getNotifier(context));
  });

  it('batch publish messages to a topic', async () => {
    nock('https://sns.us-east-1.amazonaws.com:443')
      .post('/')
      .reply(200, new xml2js.Builder().buildObject({
        PublishBatchResponse: {
          PublishBatchResult: {
            Failed: {},
            Successful: {
              MessageId: '1',
            },
          },
        },
      }));

    const notifier = new NotificationsSupport(createContext({
      runtime: { accountId: '123456789012' },
    }), true);
    try {
      await notifier.publishBatch('other', {
        owner: 'owner', repo: 'repo', ref: 'ref',
      }, [{}]);
    } finally {
      notifier.close();
    }
  });

  it('publish message truncates log output for long messages', async () => {
    nock('https://sns.us-east-1.amazonaws.com:443')
      .post('/')
      .reply(200, new xml2js.Builder().buildObject({
        PublishResponse: { PublishResult: { MessageId: '1', SequenceNumber: '1' } },
      }));

    const notifier = new NotificationsSupport(createContext({
      runtime: { accountId: '123456789012' },
    }), true);
    try {
      // result > 1000 chars triggers the truncation branch in publish()
      await notifier.publish('other', {
        owner: 'owner', repo: 'repo', ref: 'ref',
      }, { data: 'x'.repeat(1100) });
    } finally {
      notifier.close();
    }
  });

  it('publish message to a topic with a failure', async () => {
    nock('https://sns.us-east-1.amazonaws.com:443')
      .post('/')
      .reply(403, new xml2js.Builder().buildObject({
        ErrorResponse: {
          Error: {
            Type: 'Sender',
            Code: 'InvalidClientTokenId',
            Message: 'No account found for the given parameters',
          },
        },
      }));

    const notifier = new NotificationsSupport(createContext({
      runtime: { accountId: '123456789012' },
    }), true);
    try {
      await notifier.publish('other', {
        owner: 'owner', repo: 'repo', ref: 'ref',
      }, {});
    } finally {
      notifier.close();
    }
  });

  it('batch publish messages to a topic with a failure', async () => {
    nock('https://sns.us-east-1.amazonaws.com:443')
      .post('/')
      .reply(403, new xml2js.Builder().buildObject({
        ErrorResponse: {
          Error: {
            Type: 'Sender',
            Code: 'InvalidClientTokenId',
            Message: 'No account found for the given parameters',
          },
        },
      }));

    const notifier = new NotificationsSupport(createContext({
      runtime: { accountId: '123456789012' },
    }), true);
    try {
      await notifier.publishBatch('other', {
        owner: 'owner', repo: 'repo', ref: 'ref',
      }, [{}]);
    } finally {
      notifier.close();
    }
  });

  describe('publishBulkResourceNotification', () => {
    it('does not publish if notifications are disabled', async () => {
      await publishBulkResourceNotification({ data: { disableNotifications: true } }, 'foo', {}, [], []);
    });

    it('handles fatal errors', async () => {
      await publishBulkResourceNotification({ log: console }, 'foo', {}, [], undefined /** undefined resources array causes error */);
    });

    it('maps resources without path/status using webPath and defaults status to 0', async () => {
      let publishedMessage;
      nock('https://sns.us-east-1.amazonaws.com:443')
        .post('/')
        .reply((_, body) => {
          const params = new URLSearchParams(body);
          publishedMessage = JSON.parse(params.get('Message'));
          return [200, new xml2js.Builder().buildObject({
            PublishResponse: { PublishResult: { MessageId: '1', SequenceNumber: '1' } },
          })];
        });

      const context = createContext();
      // resource with webPath (no path) and no status → mapped to { path: '/doc1', status: 0 }
      // resource with status 200 → filtered out by default errorFilter (not an error)
      const resources = [{ webPath: '/doc1' }, { path: '/doc2', status: 200 }];
      await publishBulkResourceNotification(context, 'test-op', {
        owner: 'owner', repo: 'repo', ref: 'main', org: 'org', site: 'site',
      }, [], resources);

      assert.deepStrictEqual(publishedMessage.result.errors, [
        { path: '/doc1', status: 0 },
      ]);
      assert.deepStrictEqual(publishedMessage.result.resourcePaths, []);
    });

    it('correctly splits the arrays into chunks', () => {
      const paths = Array.from({ length: 100 }, (_, i) => `/documents/doc${String(i).padStart(4, '0')}.md`);
      const all = new Set(paths);
      const chunks = splitArray(paths, 400);
      for (const chunk of chunks) {
        assert.ok(JSON.stringify(chunk).length < 400);
        for (const path of chunk) {
          assert.ok(all.has(path));
          all.delete(path);
        }
      }
      assert.strictEqual(all.size, 0);
    });
  });
});
