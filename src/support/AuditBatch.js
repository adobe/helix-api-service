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

import { BatchedQueueClient, getContentBusId } from '@adobe/helix-admin-support';
import { getPackedMessageQueue, getSingleMessageQueue } from './utils.js';

/**
 * Return a flag indicating whether the outcome of an action should be logged.
 *
 * @param {import('./AdminContext.js').AdminContext} context context
 * @param {import('./RequestInfo.js').RequestInfo} info request info
 * @param {import('@adobe/fetch').Response} res response
 * @returns flag indicating whether the outcome of an action should be logged
 */
function shouldAudit(context, info, res) {
  const { attributes, runtime, log } = context;
  if (!runtime) {
    return false;
  }
  const { route, method, org } = info;
  if (['log', 'cron'].includes(route)) {
    return false;
  }
  if (!['POST', 'DELETE', 'PUT'].includes(method)) {
    return false;
  }
  if (attributes.errors?.length) {
    return true;
  }
  const { headers = {} } = info;
  if (headers['x-parent-invocation-id']) {
    return true;
  }
  const { ok, status } = res;
  if (ok) {
    return true;
  }
  if (!(status === 429 || status >= 500)) {
    return false;
  }
  const { env: { HLX_AUDIT_LOG_FAILURES: json } } = context;
  if (!json) {
    return false;
  }
  try {
    const orgs = JSON.parse(json);
    if (Array.isArray(orgs)) {
      return orgs.includes(org);
    }
  } catch (e) {
    log.warn(`error evaluating log failures for ${org}`, e);
  }
  return false;
}

/**
 * Create a notification
 *
 * @param {import('./AdminContext.js').AdminContext} context context
 * @param {import('./RequestInfo.js').RequestInfo} info request info
 * @param {Object} opts options
 * @param {Response|undefined} opts.res response or undefined
 * @param {number} opts.start start of operation
 * @param {number|undefined} opts.stop stop of operation or undefined
 * @param {URL|undefined} opts.url URL
 * @param {Record<string, unknown>} [opts.properties] properties
 * @param {boolean} [opts.logDetails] flag indicating whether to log errors and details
 * @returns {Promise<Notification>}
 */
async function createNotification(context, info, opts) {
  const { route, method } = info;
  const {
    res, start, stop, url,
    properties = {}, logDetails = true,
  } = opts;

  if (res && !shouldAudit(context, info, res)) {
    return null;
  }

  const contentBusId = await getContentBusId(context, info, true);
  if (!contentBusId) {
    return null;
  }

  const notification = {
    ...properties,
    timestamp: start,
    contentBusId,
  };

  const path = route === 'config' && !properties.migrate
    ? `${context.pathInfo.suffix.substring(7)}`
    : info.path;

  if (res) {
    Object.assign(notification, {
      duration: stop - start,
      status: res.status,
      method,
      route,
      path,
    });
    const error = res.headers.get('x-error');
    if (error) {
      notification.error = error;
    }
  }

  const user = context.attributes?.authInfo?.resolveEmail();
  if (user) {
    notification.user = user;
  }
  const forwardedFor = info.headers?.['x-forwarded-for'];
  if (forwardedFor) {
    const [originatingIP] = forwardedFor.split(',').map((s) => s.trim());
    if (originatingIP) {
      notification.ip = originatingIP;
    }
  }

  if (Array.isArray(context.data?.paths) && !notification.paths) {
    notification.paths = context.data.paths;
  }

  if (context.attributes?.snapshotManifest) {
    const { snapshotManifest } = context.attributes;
    const { id, resources } = snapshotManifest;
    notification.snapshotId = id;
    if (!notification.resources && resources instanceof Map) {
      let chars = 0;
      notification.resources = [];
      // avoid exceeding ~256KB/message
      for (const r of resources.values()) {
        chars += r.path.length;
        if (chars > 250_000) {
          break;
        }
        notification.resources.push(r);
      }
    }
  }

  if (logDetails) {
    const { attributes: { errors, details } } = context;
    if (errors.length) {
      notification.errors = errors;
    }
    if (details.length) {
      notification.details = details;
    }
  }
  const { search } = url || {};
  if (search) {
    notification.search = search;
  }
  return notification;
}

/**
 * Sends a single audit log message to the endpoint.
 *
 * @param {import('./AdminContext.js').AdminContext} context context
 * @param {import('./RequestInfo.js').RequestInfo} info request info
 * @param {object} opts options
 * @param {Response|undefined} opts.res response or undefined
 * @param {number} opts.start start of operation
 * @param {number|undefined} opts.stop stop of operation or undefined
 * @param {URL|undefined} opts.url URL
 * @param {Record<string, unknown>} opts.properties properties
 * @param {boolean} opts.logDetails flag indicating whether to log errors and details
 */
export async function audit(context, info, opts) {
  const notification = await createNotification(context, info, opts);
  if (!notification) {
    return;
  }
  const {
    org, owner, repo, ref,
  } = info;
  const { log, runtime: { region, accountId } } = context;

  if (!org) {
    log.warn('Unable to send audit entry: org is empty');
    return;
  }
  let { site } = info;
  if (!site) {
    site = '*';
  }
  const message = BatchedQueueClient.createMessage(org, site, {
    org, site, owner, repo, ref, result: notification,
  });
  const queueClient = new BatchedQueueClient({
    log,
    outQueue: getSingleMessageQueue(region, accountId, 'audit-logger', !!process.env.HLX_DEV_SERVER_HOST),
    swapBucket: context.attributes.bucketMap.content,
  });

  try {
    await queueClient.send([message]);
  } finally {
    queueClient.close();
  }
}

/**
 * Represents a batch of audit log messages.
 */
export class AuditBatch {
  constructor(info) {
    const { org, site } = info;

    const key = `${org}/${site}`;
    this.project = {
      key, updates: [],
    };
  }

  /**
   * Add a single audit message. It checks whether audit should be generated
   * for the operation passed.
   *
   * @param {import('./AdminContext.js').AdminContext} context context
   * @param {import('./RequestInfo.js').RequestInfo} info request info
   * @param {object} opts options
   */
  async add(context, info, opts) {
    const notification = await createNotification(context, info, opts);
    if (!notification) {
      return;
    }
    this.addNotification(info, notification);
  }

  /**
   * Add a notification.
   *
   * @param {import('./RequestInfo.js').RequestInfo} info request info
   * @param {object} notification notification
   */
  addNotification(info, notification) {
    const {
      owner, repo, ref, org, site,
    } = info;

    this.project.updates.push({
      org, site, owner, repo, ref, result: notification,
    });
  }

  /**
   * Send the batch as a package to the audit log end point.
   *
   * @param {import('./AdminContext.js').AdminContext} context context
   */
  async send(context) {
    const { project } = this;

    const { log, runtime: { region, accountId } } = context;
    const payload = {
      MessageGroupId: project.key,
      MessageDeduplicationId: crypto.randomUUID(),
      MessageBody: JSON.stringify(project),
    };

    const queueClient = new BatchedQueueClient({
      log,
      outQueue: getPackedMessageQueue(region, accountId, 'audit-logger', !!process.env.HLX_DEV_SERVER_HOST),
      swapBucket: context.attributes.bucketMap.content,
    });

    try {
      const messageIds = await queueClient.send([payload]);
      log.info(`Sent audit batch: [${messageIds.map((messageId) => messageId.substring(0, 8)).join(',')}]`);
    } finally {
      queueClient.close();
    }
  }

  get paths() {
    return this.project.updates.map(({ result: { path } }) => path);
  }
}
