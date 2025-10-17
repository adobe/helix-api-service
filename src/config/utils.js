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
import { AbortError } from '@adobe/fetch';
import { getFetch, getFetchOptions } from '../support/utils.js';
import { StatusCodeError } from '../support/StatusCodeError.js';

async function loadConfig(context, url, type) {
  const { log, env, attributes } = context;
  const fetch = getFetch(attributes);

  const fopts = getFetchOptions();
  fopts.headers['x-access-token'] = env.HLX_CONFIG_SERVICE_TOKEN;
  fopts.headers['x-backend-type'] = 'aws';

  try {
    const response = await fetch(url, fopts);
    const { ok, status } = response;
    if (ok) {
      log.info(`loaded ${type} config from ${url}`);
      const config = await response.json();
      return config;
    }
    if (status !== 404) {
      log.warn(`error loading ${type} config from ${url}: ${response.status}`);
    }
    return null;
  } catch (e) {
    const msg = `Fetching ${type} config from ${url} failed: ${e.message}`;
    throw new StatusCodeError(msg, e instanceof AbortError ? 504 : /* c8 ignore next */ 502);
    /* c8 ignore next 5 */
  } finally {
    if (fopts.signal) {
      fopts.signal.clear();
    }
  }
}

export async function loadSiteConfig(context, org, site) {
  const url = `https://config.aem.page/main--${site}--${org}/config.json?scope=admin`;
  return loadConfig(context, url, 'site');
}

export async function loadOrgConfig(context, org) {
  const url = `https://config.aem.page/${org}/config.json?scope=admin`;
  return loadConfig(context, url, 'org');
}
