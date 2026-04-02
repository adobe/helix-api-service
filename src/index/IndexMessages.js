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
import { BatchedQueueClient, hsize } from '@adobe/helix-admin-support';
import { Partitioner } from './Partitioner.js';
import { getUpdatesQueue, getTasksQueue } from './utils.js';

/**
 * Maximum size of a message to append to the batched queue.
 */
export const MAX_MESSAGE_SIZE = 100_000;

/**
 * Threshold for sending indexing jobs directly to the FIFO queue.
 */
const THRESHOLD_FIFO = 50;

/**
 * Represents a map of index records, keyed by path.
 * @class
 */
export class IndexMessages {
  /** @type {string} */
  org;

  /** @type {string} */
  site;

  /** @type {object[]} */
  messages = [];

  /**
   * Initialize the index messages.
   */
  constructor(org, site) {
    this.org = org;
    this.site = site;
  }

  /**
   * Append a message for the {BatchedQueueClient} and push it to an array of messages. Skip
   * the message if it exceeds a certain size and log a warning.
   */
  append(msg, log) {
    const { messages } = this;

    const size = Buffer.from(JSON.stringify(msg), 'utf8').length;
    if (size > MAX_MESSAGE_SIZE) {
      log.warn(`Message too big: ${hsize(size)} bytes. Skipping...`);
    } else {
      messages.push(msg);
    }
  }

  appendChanged(name, type, record, log) {
    const { org, site } = this.info;
    const message = BatchedQueueClient.createMessage(org, site, {
      index: name,
      record,
      timestamp: Date.now(),
      type,
    });
    this.append(message, log);
  }

  appendDeleted(name, webPath, type, log) {
    const { org, site } = this.info;
    const message = BatchedQueueClient.createMessage(org, site, {
      index: name,
      deleted: true,
      record: {
        path: webPath,
      },
      timestamp: Date.now(),
      type,
    });
    this.append(message, log);
  }

  /**
   * Send updates to our updates queue.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   */
  async #sendUpdates(context) {
    const { messages } = this;
    const { log, runtime: { region, accountId } } = context;

    const queueClient = new BatchedQueueClient({
      log,
      outQueue: getUpdatesQueue(region, accountId, !!process.env.HLX_DEV_SERVER_HOST),
      swapBucket: context.attributes.bucketMap.content,
    });

    try {
      const messageIds = await queueClient.send(messages);
      log.info(`Sent ${messageIds.length} index updates`);
    } finally {
      queueClient.close();
    }
  }

  /**
   * Pump messages directly, i.e. send them to our tasks queue.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   */
  async #sendTask(context) {
    const { org, site, messages } = this;
    const { log, runtime: { region, accountId } } = context;

    const project = {
      key: `${org}/${site}`,
      owner: org,
      repo: site,
      updates: messages.map(({ MessageBody }) => JSON.parse(MessageBody)),
    };

    const payloads = Partitioner.partition(project).map((chunk) => ({
      MessageGroupId: project.key,
      MessageDeduplicationId: crypto.randomUUID(),
      MessageBody: JSON.stringify(chunk),
    }));
    const queueClient = new BatchedQueueClient({
      log,
      outQueue: getTasksQueue(region, accountId, !!process.env.HLX_DEV_SERVER_HOST),
      swapBucket: context.attributes.bucketMap.content,
    });

    try {
      const messageIds = await queueClient.send(payloads);
      if (messageIds.length) {
        log.info(`Sent indexing tasks: [${messageIds.map((messageId) => messageId.substring(0, 8)).join(',')}]`);
      }
    } finally {
      queueClient.close();
    }
  }

  async send(context) {
    const { messages } = this;
    if (messages.length > THRESHOLD_FIFO) {
      await this.#sendTask(context);
    } else if (messages.length) {
      await this.#sendUpdates(context);
    }
  }
}
