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
import { computeSurrogateKey } from '@adobe/helix-shared-utils';

/**
 * Returns the surrogate key based on the contentBusId and the resource path
 * @param {string} contentBusId content bus id
 * @param {string} path resource path
 * @returns {Promise<string>}
 */
export async function computeContentPathKey(contentBusId, path) {
  // strip [index].plain.html
  let p = path.replace(/(index)?\.plain\.html$/, '');
  // strip .md
  p = p.replace(/\.md$/, '');
  return computeSurrogateKey(`${contentBusId}${p}`);
}

/**
 * Returns the surrogate key based on ref, repo, owner and the resource path
 * @param {Object} params
 * @param {string} [params.ref] ref
 * @param {string} [params.repo] repo
 * @param {string} [params.owner] owner
 * @param {string} path resource path
 * @returns {Promise<string>}
 */
export async function computeCodePathKey({ ref, repo, owner }, path) {
  return computeSurrogateKey(`${ref}--${repo}--${owner}${path}`);
}

/**
 * Removes redundant path-based surrogate key if the corresponding path is present.
 * @param {Object} params
 * @param {string} [params.contentBusId] contentBusId
 * @param {string} [params.ref] ref
 * @param {string} [params.repo] repo
 * @param {string} [params.owner] owner
 * @param {Object} purgeParams purge parameters
 * @param {Array<string>} [purgeParams.keys] keys (tags) to purge
 * @param {Array<string>} [purgeParams.paths] url paths to purge
*/
export async function removeRedundantKeys({
  contentBusId,
  ref,
  repo,
  owner,
}, { keys: ka = [], paths = [] }) {
  const keys = [...ka];
  if (!keys.length || !paths.length) {
    return { keys, paths };
  }
  for (const path of paths) {
    // compute surrogate keys for path
    // eslint-disable-next-line no-await-in-loop
    const contentKey = await computeContentPathKey(contentBusId, path);
    // eslint-disable-next-line no-await-in-loop
    const codeKey = await computeCodePathKey({ ref, repo, owner }, path);
    // remove path-based surrogate key if the corresponding path is purged also
    let i = keys.indexOf(contentKey);
    if (i > -1) {
      keys.splice(i, 1);
    }
    i = keys.indexOf(`p_${contentKey}`);
    if (i > -1) {
      keys.splice(i, 1);
    }
    i = keys.indexOf(codeKey);
    if (i > -1) {
      keys.splice(i, 1);
    }
  }
  return { keys, paths };
}

/**
 * Removes redundant path if corresponding path-based surrogate key is present.
 * @param {Object} params
 * @param {string} [params.contentBusId] contentBusId
 * @param {string} [params.ref] ref
 * @param {string} [params.repo] repo
 * @param {string} [params.owner] owner
 * @param {Object} purgeParams purge parameters
 * @param {Array<string>} [purgeParams.keys] keys (tags) to purge
 * @param {Array<string>} [purgeParams.paths] url paths to purge
*/
export async function removeRedundantPaths({
  contentBusId,
  ref,
  repo,
  owner,
}, { keys = [], paths: pa = [] }) {
  const paths = [];
  for (const p of pa) {
    // compute surrogate keys for path
    // eslint-disable-next-line no-await-in-loop
    const contentKey = await computeContentPathKey(contentBusId, p);
    // eslint-disable-next-line no-await-in-loop
    const codeKey = await computeCodePathKey({ ref, repo, owner }, p);
    if (!keys.includes(contentKey)
      && !keys.includes(`p_${contentKey}`)
      && !keys.includes(codeKey)) {
      paths.push(p);
    }
  }
  return { keys, paths };
}

/**
 * Sleeps for the given time (ms)
 */
export const WOKEUP = 'woke up!';
export const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms, WOKEUP);
});
