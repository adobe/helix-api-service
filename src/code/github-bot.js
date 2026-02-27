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
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { measure } from '../support/utils.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { RateLimitError } from './rate-limit-error.js';

const DEPLOYMENT_SYNC = 'aem-code-sync';

export const BYOGIT_INSTALLATION_ID = 'byogit';

/**
 * @typedef {import('../index').AdminContext} AdminContext
 * @typedef {import('../index').PathInfo} PathInfo
 * @typedef { 'error'
 *            |'failure'
 *            |'in_progress'
 *            |'inactive'
 *            |'pending'
 *            |'queued'
 *            |'success'
 * } DeploymentState
 */

/**
 * Returns the octokit for the app
 * @param {AdminContext} ctx
 * @returns {Octokit}
 */
export function getAppOctokit(ctx) {
  /* c8 ignore next 3 */
  if (!ctx.attributes.octokits) {
    ctx.attributes.octokits = {};
  }
  if (!ctx.attributes.octokits.app) {
    const {
      GH_APP_ID, GH_APP_PRIVATE_KEY, GH_CLIENT_ID, GH_CLIENT_SECRET,
    } = ctx.env;
    ctx.attributes.octokits.app = new Octokit({
      request: {
        fetch: ctx.getFetch(),
      },
      authStrategy: createAppAuth,
      auth: {
        appId: GH_APP_ID,
        privateKey: GH_APP_PRIVATE_KEY,
        clientId: GH_CLIENT_ID,
        clientSecret: GH_CLIENT_SECRET,
      },
      log: ctx.log,
    });
  }
  return ctx.attributes.octokits.app;
}

/**
 * Returns the octokit for the installation
 * @param {AdminContext} ctx
 * @param {string} installationId
 * @returns {Octokit}
 */
export function getInstallationOctokit(ctx, installationId) {
  /* c8 ignore next 3 */
  if (!ctx.attributes.octokits) {
    ctx.attributes.octokits = {};
  }
  if (!ctx.attributes.octokits[installationId]) {
    const {
      GH_APP_ID, GH_APP_PRIVATE_KEY, GH_CLIENT_ID, GH_CLIENT_SECRET,
    } = ctx.env;

    ctx.attributes.octokits[installationId] = new Octokit({
      authStrategy: createAppAuth,
      request: {
        fetch: ctx.getFetch(),
      },
      auth: {
        appId: GH_APP_ID,
        privateKey: GH_APP_PRIVATE_KEY,
        clientId: GH_CLIENT_ID,
        clientSecret: GH_CLIENT_SECRET,
        installationId,
      },
      log: ctx.log,
    });
  }
  return ctx.attributes.octokits[installationId];
}

/**
 * @param {AdminContext} ctx
 * @param {PathInfo} opts
 * @returns {Octokit | null}
 */
export async function getInstallationForRepo(ctx, opts) {
  /* c8 ignore next 3 */
  if (!ctx.attributes.installations) {
    ctx.attributes.installations = {};
  }
  const { owner, repo } = opts;
  const key = `${owner}/${repo}`;
  if (!ctx.attributes.installations[key]) {
    const octokit = getAppOctokit(ctx);
    try {
      const { data } = await octokit.apps.getRepoInstallation({
        owner,
        repo,
      });
      ctx.attributes.installations[key] = data;
    } catch (e) {
      ctx.log.error(`unable to obtain repository installation for ${key}: ${e.message}`);
      return null;
    }
  }
  return ctx.attributes.installations[key];
}

/**
 * @param {AdminContext} ctx
 * @param {CodeSource} codeSource
 * @returns {Octokit}
 */
export function setTokenOctokit(ctx, codeSource) {
  if (!ctx.attributes.octokits) {
    ctx.attributes.octokits = {};
  }

  ctx.attributes.octokits[codeSource.installationId] = new Octokit({
    log: ctx.log,
    request: {
      fetch: ctx.getFetch(),
    },
    auth: `token ${codeSource.token}`,
    baseUrl: codeSource.base_url,
  });
  return ctx.attributes.octokits[codeSource.installationId];
}

/**
 * Setup the installation octokit in the context based on the event information.
 * Returns the code info.
 * @param ctx
 * @param event
 * @returns {CodeSource}
 */
export async function getCodeSource(ctx, event) {
  const { log } = ctx;
  const {
    GH_BASE_URL = 'https://api.github.com',
    GH_RAW_URL = 'https://raw.githubusercontent.com',
  } = ctx.env;

  const codeSource = {
    owner: event.owner,
    repo: event.repo,
    installationId: event.installationId,
    base_url: GH_BASE_URL,
    raw_url: GH_RAW_URL,
    ...ctx.attributes.config?.code?.source ?? {},
  };

  if (codeSource.url) {
    const url = new URL(codeSource.url);
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
      if (codeSource.secret) {
        codeSource.token = codeSource.secret;
      } else if (codeSource.secretId) {
        ctx.log.warn(`byogit secret not found for ${url.href}`);
      }
      delete codeSource.secret;
      codeSource.base_url = url.href;
      codeSource.installationId = BYOGIT_INSTALLATION_ID;
      // eslint-disable-next-line no-param-reassign
      event.installationId = codeSource.installationId;
      ctx.log.info(`byogit detected for ${event.owner}/${event.repo}:`, codeSource);
    }
  }

  // get bot token if not set on context
  if (codeSource.token || codeSource.installationId === BYOGIT_INSTALLATION_ID) {
    if (codeSource.installationId) {
      codeSource.octokit = setTokenOctokit(ctx, codeSource);
    } else {
      throw new StatusCodeError('using github token needs installation id.', 400);
    }
  } else {
    log.info('obtaining helix-bot authentication');
    const installation = await getInstallationForRepo(ctx, event);
    if (!installation) {
      throw new StatusCodeError('github bot not installed on repository.', 400);
    }
    if (event.installationId && event.installationId !== installation.id) {
      throw new StatusCodeError('event installation id does not match repository installation id', 400);
    } else {
      // eslint-disable-next-line no-param-reassign
      event.installationId = installation.id;
    }
    const octokit = getInstallationOctokit(ctx, installation.id);
    const authentication = await octokit.auth({ type: 'installation' });
    codeSource.octokit = octokit;
    codeSource.token = authentication.token;
  }
  return codeSource;
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} pref
 *
 * @returns {string}
 */
function getDeploymentURL(ctx, owner, repo, pref) {
  const ref = pref.replace(/\//g, '-');
  return `https://${ref}--${repo}--${owner}.aem.page`;
}

/**
 * Check if error is caused by integration lacking permission.
 *
 * Once the Github app is updated for deployments, clients will need to accept the new permission
 * to include read/write on deployments.
 *
 * @param {Error} e
 */
function isPermissionError(e) {
  return e.message.includes('Resource not accessible by integration');
}

/**
 * @param {AdminContext} ctx
 * @param {Octokit} octokit
 * @param {string} id
 * @param {CodeSource} codeSource
 * @param {PathInfo} info
 * @param {{
 *  state: DeploymentState;
 *  url?: string;
 *  description?: string;
 * }} opts
 * @returns {Promise<void>}
 */
export async function updateDeployment(
  ctx,
  octokit,
  id,
  codeSource,
  info,
  { state, description, url },
) {
  const { repo, owner, ref } = info;
  const envUrl = getDeploymentURL(ctx, owner, repo, ref);
  try {
    await octokit.repos.createDeploymentStatus({
      repo: codeSource.repo,
      owner: codeSource.owner,
      deployment_id: id,
      environment_url: envUrl,
      log_url: url,
      state,
      description,
    });
  } catch (e) {
    if (isPermissionError(e)) {
      ctx.log.info(`missing deployment permissions on ${owner}/${repo}`);
      return false;
    } else {
      ctx.log.error(`failed to update deployment on ${owner}/${repo} id=${id} state=${state}`, e);
    }
  }
  return true;
}

/**
 * @param {AdminContext} ctx
 * @param {Octokit} octokit
 * @param {CodeSource} codeSource
 * @param {PathInfo} info
 * @param {{
 *  state: DeploymentState;
 *  url?: string;
 *  description?: string;
 * }|undefined} [opts]
 * @returns {Promise<string|false>} deployment ID, false on failure
 */
export async function createDeployment(ctx, octokit, codeSource, info, opts) {
  const { repo, owner, ref } = info;
  try {
    const { data: { id } } = await octokit.repos.createDeployment({
      ref,
      environment: ref,
      repo: codeSource.repo,
      task: DEPLOYMENT_SYNC,
      owner: codeSource.owner,
      // don't merge default branch into deployment branch, this could lead to unexpected results
      auto_merge: false,
      payload: {},
      required_contexts: [],
    });

    if (opts && opts.state) {
      // also update state
      await updateDeployment(ctx, octokit, id, codeSource, info, opts);
    }

    return id;
  } catch (e) {
    const { log } = ctx;
    if (isPermissionError(e)) {
      log.info(`missing deployment permissions on ${owner}/${repo}`);
    } else {
      log.error(`failed to create deployment on ${owner}/${repo} state=${opts.state}: ${e.message}`);
      log.debug(e);
    }
    return false;
  }
}

/**
 * Logs the current rate limit for the given installation and stores it on the data object.
 * @param ctx
 * @param evt
 * @param data
 * @param octokit
 * @returns {Promise<object>}
 */
export async function logGithubRateLimit(ctx, evt, data, octokit) {
  const { log } = ctx;
  try {
    const rate = await octokit.rateLimit.get();
    log.info(JSON.stringify({
      metric: 'github-ratelimit',
      owner: evt.owner,
      repo: evt.repo,
      ref: evt.ref,
      installationId: evt.installationId,
      limits: rate.data.resources.core,
    }));
    // eslint-disable-next-line no-param-reassign
    data.githubRateLimit = rate.data.resources.core;
    return data.githubRateLimit;
  } catch (e) {
    log.warn('unable to get github ratelimit:', e.message);
    return null;
  }
}

/**
 * Logs the github error response including rate limits
 * @param log
 * @param res
 * @param nr
 * @param message
 * @returns {Promise<void>}
 */
export async function logGithubErrorResponse(log, res, nr, message) {
  if (res.status === 403 || res.status === 429) {
    log.warn(`[code][${nr}] ${message}: ${res.status}: ${await res.text()}.
               retry-after=${res.headers.get('retry-after')},
               x-ratelimit-remaining=${res.headers.get('x-ratelimit-remaining')},
               x-ratelimit-reset=${res.headers.get('x-ratelimit-reset')}
               `);
  } else {
    const level = res.status === 404 ? 'info' : 'warn';
    log[level](`[code][${nr}] ${message}: ${res.status}: ${await res.text()}`);
  }
}

/**
 * Fetches the content from github via the github raw url. if this fails due to a 429,
 * it will retry using the github API.
 * @see https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28#get-repository-content
 * @param {AdminContext} ctx
 * @param {CodeSource} codeSource
 * @param {string} ref
 * @param {string} path
 * @param {string} branch
 * @param {number} nr
 * @param {object} timer
 * @returns {Promise<Response>}
 */
export async function fetchContent(ctx, codeSource, ref, path, branch, nr, timer) {
  const { log } = ctx;
  let url = new URL(`${codeSource.raw_url}/${codeSource.owner}/${codeSource.repo}/${ref}/${path}`);
  const opts = {
    timeout: 20000,
    headers: {
      authorization: `token ${codeSource.token}`,
    },
    cache: 'no-store',
  };
  const fetch = ctx.getFetch();
  log.info(`[code][${nr}] fetching ${url} from github`);
  let res = await measure(() => fetch(url, opts), timer);
  // eslint-disable-next-line no-param-reassign
  timer.fetch += 1;
  if (res.status === 429 && codeSource.installationId !== BYOGIT_INSTALLATION_ID) {
    log.warn(`[code][${nr}] rate limit error from github (url=${url}, branch=${branch}): ${res.status}: ${await res.text()}. retry via API`);
    url = new URL(`${codeSource.base_url}/repos/${codeSource.owner}/${codeSource.repo}/contents/${path}`);
    url.searchParams.append('ref', ref);
    opts.headers = {
      authorization: `Bearer ${codeSource.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      accept: 'application/vnd.github.raw+json',
    };
    log.info(`[code][${nr}] fetching ${url} from github`);
    res = await measure(() => fetch(url, opts), timer);
    // eslint-disable-next-line no-param-reassign
    timer.fetch += 1;
  }
  if (!res.ok) {
    const msg = `error reading content from github. (url=${url}, branch=${branch})`;
    await logGithubErrorResponse(log, res, nr, msg);
    if (res.status === 429) {
      throw new RateLimitError(msg, res.headers.get('retry-after'), res.headers.get('x-ratelimit-reset'));
    }
  }
  return res;
}

/**
 * Fetches the sha for the given ref (branch or tag)
 * @param ctx
 * @param codeSource
 * @param ref
 * @param isTag
 * @returns {Promise<string>}
 */
export async function getRefSha(ctx, codeSource, ref, isTag) {
  const { owner, repo, octokit } = codeSource;
  if (isTag) {
    const gitRef = `tags/${ref}`;
    ctx.log.info(`[code] fetching sha for ${owner}/${repo}/tags/${gitRef} from github`);
    // get tree-sha of tag
    const res = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      repo,
      ref: gitRef,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    return res.data.object.sha;
  } else {
    ctx.log.info(`[code] fetching sha for ${owner}/${repo}/${ref} from github`);
    // get tree-sha of branch
    const res = await octokit.repos.getBranch({
      owner,
      repo,
      branch: ref,
    });
    return res.data.commit.sha;
  }
}

/**
 * Returns the rate limits or null if nt possible
 * @param ctx
 * @param codeSource
 * @returns {Promise<object|null>}
 */
export async function getRateLimits(ctx, codeSource) {
  try {
    const rate = await codeSource.octokit.rateLimit.get();
    ctx.log.info('%j', {
      metric: {
        metric: 'github-ratelimit',
        owner: codeSource.owner,
        repo: codeSource.repo,
        ref: codeSource.ref,
        installationId: codeSource.installationId,
        limits: rate.data.resources.core,
      },
    });
    return rate.data.resources.core;
  } catch (e) {
    ctx.log.warn('[code] unable to get github ratelimit:', e.message);
    return null;
  }
}
