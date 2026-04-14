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
import crypto from 'crypto';
import { PublishBatchCommand, PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent } from 'node:https';

/**
 * Notifications support class.
 */
export class NotificationsSupport {
  constructor(ctx) {
    const { runtime: { region, accountId }, log } = ctx;

    this.topicARN = `arn:aws:sns:${region}:${accountId}:helix-admin.fifo`;

    log.info(`Using SNS client on: ${this.topicARN}`);

    this.sns = new SNSClient({
      region,
      requestHandler: new NodeHttpHandler({
        httpsAgent: new Agent({
          keepAlive: true,
        }),
      }),
    });
    this.log = log;
  }

  /**
   * Publish a notification to a topic
   *
   * @param {string} op
   * @param {import('../support/RequestInfo').RequestInfo} info
   * @param {Record<string, unknown>} result
   * @returns {Promise<void>}
   */
  async publish(op, info, result) {
    const {
      owner, repo, ref, org, site,
    } = info;
    const { topicARN, sns, log } = this;

    const msg = JSON.stringify({
      op, org, site, owner, repo, ref, result,
    }, null, 2);
    const input = {
      TopicArn: topicARN,
      Message: msg,
    };
    input.MessageDeduplicationId = crypto.randomUUID();
    input.MessageGroupId = `${owner}/${repo}`;

    try {
      await sns.send(new PublishCommand(input));
      if (op !== 'audit') {
        // truncate message if too long...
        const logMsg = msg.length > 1000 ? `${msg.substring(0, 1000)}...` : msg;
        log.info(`Published message to topic (${topicARN}): ${logMsg}`);
      }
    } catch (e) {
      log.debug('Publish failed', JSON.stringify(input, 0, 2));
      log.warn(`Unable to send notification for ${op}`, e);
    }
  }

  /**
   * Batch publish notifications to a topic.
   */
  async publishBatch(op, info, results) {
    const {
      owner, repo, ref, org, site,
    } = info;
    const { topicARN, sns, log } = this;

    const entries = results.map((result) => {
      const entry = {
        Message: JSON.stringify({
          op, org, site, owner, repo, ref, result,
        }),
        Id: crypto.randomUUID(),
      };
      entry.MessageDeduplicationId = crypto.randomUUID();
      entry.MessageGroupId = `${owner}/${repo}`;
      return entry;
    });
    const input = {
      TopicArn: topicARN,
      PublishBatchRequestEntries: entries,
    };

    try {
      await sns.send(new PublishBatchCommand(input));
      if (op !== 'audit') {
        log.info(`Published ${results.length} message to topic (${topicARN})`);
      }
    } catch (e) {
      log.debug('PublishBatch failed', JSON.stringify(input, 0, 2));
      log.warn(`Unable to send notification for ${op}`, e);
    }
  }

  /**
   * Close this notification support instance.
   */
  close() {
    this.sns.destroy();
  }
}

/**
 * Returns an existing or creates a new notifier.
 *
 * @param {import('./AdminContext').AdminContext} ctx context
 * @returns {NotificationsSupport}
 */
export function getNotifier(ctx) {
  const prop = 'notifierFifo';
  if (ctx.attributes[prop] === undefined) {
    ctx.attributes[prop] = new NotificationsSupport(ctx);
  }
  return ctx.attributes[prop];
}

/**
 * Returns an array of array limiting the json serialized size of each chunk to the `limit`.
 * it does this via a binary tree, i.e. having each chunk if too big. this should be relatively
 * fast. please note that the original array is modified.
 */
export function splitArray(paths, limit) {
  const chunks = [];
  if (JSON.stringify(paths).length > limit) {
    const left = paths.splice(0, paths.length / 2);
    chunks.push(...splitArray(left, limit));
    chunks.push(...splitArray(paths, limit));
  } else {
    chunks.push(paths);
  }
  return chunks;
}

/**
 * Publish a notification for multiple resources.
 *
 * @param {import('../support/AdminContext').AdminContext} ctx
 * @param {string} op notification type
 * @param {import('../support/RequestInfo').RequestInfo} info path info
 * @param {string[]} resourcePaths paths that succeeded the operation
 * @param {{
 *  status?:number; path?:string; webPath?:string; resourcePath:string;
 * }[]} resources all resources, used for error reporting
 * @param {
 *  (rsc: { status?: number; }) => boolean
 * } [errorFilter] function to filter errors, defaults to anything not 2xx
 */
export async function publishBulkResourceNotification(
  ctx,
  op,
  info,
  resourcePaths,
  resources,
  errorFilter = ({ status }) => !(status >= 200 && status < 300),
) {
  const { snapshotId } = info;
  try {
    if (ctx.data?.disableNotifications) {
      return;
    }

    const errors = resources
      .filter(errorFilter) // undefined == stopped == error
      .map(({ path, webPath, status }) => ({
        status: status || 0,
        path: path || webPath,
      }));

    if (resourcePaths.length || errors.length) {
      // limit paths array to 250k, in order to be safe for AWS SNS Message limit of 256kb
      const chunks = splitArray(resourcePaths, 250 * 1024);
      for (const paths of chunks) {
        // eslint-disable-next-line no-await-in-loop
        await getNotifier(ctx).publish(op, info, {
          snapshotId,
          resourcePaths: paths,
          errors,
        });
      }
    }
  } catch (e) {
    ctx.log.warn(`Unable to publish bulk resource notification for ${op}`, e);
  }
}
