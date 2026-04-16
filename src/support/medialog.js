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

import { BatchedQueueClient } from '@adobe/helix-admin-support';
import { getPackedMessageQueue, getSingleMessageQueue } from './utils.js';

/**
 * Sends a single media log message to the queue.
 *
 * @param {import('./AdminContext.js').AdminContext} context admin context
 * @param {string} contentBusId content bus identifier
 * @param {object} notification media log entry
 */
export async function mediaLog(context, contentBusId, notification) {
  const { log, runtime: { region, accountId } } = context;

  if (!contentBusId) {
    log.warn('Unable to send media log entry: contentBusId is empty');
    return;
  }

  const message = BatchedQueueClient.createMessage(contentBusId, contentBusId, {
    contentBusId,
    ...notification,
  });

  const queueClient = new BatchedQueueClient({
    log,
    outQueue: getSingleMessageQueue(region, accountId, 'media-log', !!process.env.HLX_DEV_SERVER_HOST),
    swapBucket: context.attributes.bucketMap.content,
  });

  try {
    await queueClient.send([message]);
  } finally {
    queueClient.close();
  }
}

/**
 * Represents a batch of media log messages.
 */
export class MediaLogBatch {
  constructor(contentBusId) {
    this.contentBusId = contentBusId;
    this.updates = [];
  }

  /**
   * Add a notification to the batch.
   *
   * @param {object} notification media log notification
   */
  addNotification(notification) {
    this.updates.push(notification);
  }

  /**
   * Send the batch as a package to the media log queue.
   *
   * @param {import('./AdminContext.js').AdminContext} context admin context
   */
  async send(context) {
    const { contentBusId, updates } = this;

    /* c8 ignore next 3 - defensive check */
    if (updates.length === 0) {
      return;
    }

    const { log, runtime: { region, accountId } } = context;
    const payload = {
      MessageGroupId: contentBusId,
      MessageDeduplicationId: crypto.randomUUID(),
      MessageBody: JSON.stringify({ contentBusId, updates }),
    };

    const queueClient = new BatchedQueueClient({
      log,
      outQueue: getPackedMessageQueue(region, accountId, 'media-log', !!process.env.HLX_DEV_SERVER_HOST),
      swapBucket: context.attributes.bucketMap.content,
    });

    try {
      const messageIds = await queueClient.send([payload]);
      log.info(`Sent media log batch: [${messageIds.map((messageId) => messageId.substring(0, 8)).join(',')}]`);
    } finally {
      queueClient.close();
    }
  }
}
