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
import mime from 'mime';
import { GitUrl } from '@adobe/helix-shared-git';
import {
  CodeJob,
  getCodeRef,
  isValidPath,
} from './code-job.js';
import { BYOGIT_INSTALLATION_ID, getCodeSource, getRateLimits } from './github-bot.js';
import { Job } from '../job/job.js';
import { errorResponse } from '../support/utils.js';

/**
 * @typedef {import('./index').ChangeEvent} ChangeEvent
 * @typedef {import('../index').AdminContext} AdminContext
 */

/**
 * Allow deployment to be created and updated when event.changes exist
 * and initiator has code:write permission.
 *
 * @param {AdminContext} ctx
 */
function isDeploymentAllowed(ctx) {
  const { attributes: { authInfo } } = ctx;
  return authInfo?.hasPermissions('code:write') === true;
}

/**
 * Updates a code resource by fetching the content from github and storing it in the code-bus.
 * For code syncs that originate from github-bot or for branch syncs, it starts a job and returns
 * the job information.
 *
 * @param {import('../support/AdminContext').AdminContext} ctx context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function update(ctx, info) {
  const { log } = ctx;
  /** @type {ChangeEvent} */
  const event = ctx.data;
  let startJob = true;
  if (!event.changes) {
    // don't start job for single sync request
    startJob = info.rawPath.endsWith('/*');

    const testPath = startJob
      ? info.rawPath.substring(0, info.rawPath.length - 2)
      : info.rawPath;
    if (!isValidPath(testPath)) {
      return errorResponse(log, 404, 'Unsupported characters in path');
    }
    // only allow recursive updates for root path
    if (startJob && testPath !== '') {
      return errorResponse(log, 400, 'Recursive updates are only supported for root path.');
    }

    const path = info.rawPath.substring(1);
    let contentType = mime.getType(path);
    if (contentType?.startsWith('text/')) {
      contentType += '; charset=utf-8';
    }
    const type = info.method === 'DELETE' ? 'deleted' : 'modified';
    event.changes = [{
      type,
      path,
      contentType,
    }];
    event.owner = info.owner;
    event.repo = info.repo;
    event.branch = ctx.data?.branch || info.ref;
    if (startJob) {
      log.info(`[code][${event.owner}/${event.repo}/*] explicit '${type}' branch operation requested.`);
    }
  } else {
    event.deploymentAllowed = isDeploymentAllowed(ctx);
  }
  if (String(event.tag) === 'true') {
    // avoid setting false
    event.tag = true;
  }

  // ensure that owner/repo is always using the codebus owner/repo, even if the event or request
  // is pointed at org/site
  const { code } = ctx.attributes.config;
  event.codeOwner = code.owner;
  event.codeRepo = code.repo;
  // for github repos, we also set the event coordinates accordingly
  const url = new URL(code.source.url);
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const gitUrl = new GitUrl(code.source.url);
    event.owner = gitUrl.owner;
    event.repo = gitUrl.repo;
  } else if (code.source.owner && code.source.repo) {
    event.owner = code.source.owner;
    event.repo = code.source.repo;
  } else {
    log.warn(`missing code.source.owner or code.source.repo for byogit for ${info.org}/${info.site}`);
  }

  // calculate codebus prefix
  event.codeRef = getCodeRef(event.branch);
  event.codePrefix = `/${event.codeOwner}/${event.codeRepo}/${event.codeRef}/`;
  log.info(`code-sync ${info.org}/${info.site} syncing ${event.owner}/${event.repo}/${event.branch} to ${event.codePrefix}`);

  // this ensures that the octokit is setup
  const codeSource = await getCodeSource(ctx, event);
  // disable deployment for byogit
  if (codeSource.installationId === BYOGIT_INSTALLATION_ID) {
    event.deploymentAllowed = false;
  }

  // check github rate limits
  const limits = await getRateLimits(ctx, codeSource);
  if (limits) {
    // {"limit":12500,"used":12506,"remaining":0,"reset":1760023064}
    if (limits.remaining === 0) {
      return errorResponse(log, 429, `GitHub API rate limit exceeded for ${event.owner}/${event.codeRepo}: ${limits.used}/${limits.limit}`, {
        headers: {
          'retry-after': new Date(limits.reset * 1000).toUTCString(),
        },
      });
    }
  }

  return Job.create(ctx, info, 'code', {
    jobClass: CodeJob,
    transient: !startJob,
    data: event,
    roles: ['code'],
  });
}
