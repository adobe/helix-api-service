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

import { HelixStorage } from '@adobe/helix-shared-storage';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { RateLimitError } from './rate-limit-error.js';

/**
 * Reads the github tree for the given repository and creates a change event. The change set
 * contains all the files in the given branch, with the exception of the '.github' directory.
 *
 * @param {UniversalContext} ctx context
 * @param {CodeSource} codeSource
 * @param {ChangeEvent} evt path info
 * @param {string} sha sha of reference to create tree against, optional
 * @returns {Promise<Change[]>} change events simulating added files
 */
export default async function getTreeChanges(ctx, codeSource, evt, sha) {
  const { log } = ctx;
  const {
    codeRef, codeOwner, codeRepo, owner, repo,
  } = evt;
  const { octokit } = codeSource;
  const ref = evt.branch || evt.ref;
  try {
    log.info(`fetching tree for ${owner}/${repo}/${ref} (${sha}) from github`);
    const res = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: sha,
      recursive: true,
    });
    if (res.data.truncated) {
      throw new Error('tree too large to sync. rejecting truncated result.');
    }

    // setup the map of all files
    const tree = new Map();
    for (const entry of res.data.tree) {
      if (entry.type === 'blob') {
        tree.set(entry.path, {
          type: 'added',
          path: entry.path,
          commit: res.data.sha,
        });
      }
    }

    // read the code-bus and mark the respective items as modified or deleted
    log.info(`fetching code-bus list from ${owner}/${repo}/${codeRef}`);
    const storage = HelixStorage.fromContext(ctx).codeBus();
    const codeObjs = await storage.list(`${codeOwner}/${codeRepo}/${codeRef}/`);
    let added = tree.size;
    let modified = 0;
    let deleted = 0;
    for (const obj of codeObjs) {
      if (obj.path === 'helix-config.json') {
        // eslint-disable-next-line no-continue
        continue;
      }
      const file = tree.get(obj.path);
      if (file) {
        file.type = 'modified';
        added -= 1;
        modified += 1;
      } else {
        deleted += 1;
        if (deleted < 10) {
          // don't log too much for large deletions
          log.info(`code-bus file missing in github. marking as deleted: ${owner}/${repo}/${ref}/${obj.path}`);
        }
        tree.set(obj.path, {
          type: 'deleted',
          path: obj.path,
        });
      }
    }
    log.info(`tree events for ${owner}/${repo}/${ref}. added:${added}, modified:${modified}, deleted:${deleted}`);
    return /** @type Change[] */ Array.from(tree.values());
  } catch (e) {
    const msg = e.message || e.status;
    log.error(`fetching tree for ${codeOwner}/${codeRepo}/${ref} from github error: ${msg}`);
    const errorMsg = `Unable to list tree for ${codeOwner}/${codeRepo}/${ref}: ${msg}`;
    if (e.status === 401) {
      throw new StatusCodeError(errorMsg, 401);
    }
    if (e.status === 429) {
      throw new RateLimitError(errorMsg, e.response.headers['retry-after'], e.response.headers['x-ratelimit-reset']);
    }
    throw new Error(errorMsg);
  }
}
