/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';

/**
 * @typedef ValidationResult
 * @property {string} org
 * @property {string} site
 * @property {URL} sourceUrl
 * @property {string} sourcePath
 * @property {Response} error
 */

/**
 * Validates if the content source is properly configured and if org/site match.
 *
 * @param {import('../support/AdminContext').AdminContext} ctx context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} [opts] options
 * @param {object} [opts.source] content source
 * @param {string} [opts.lastModified] last modified
 * @param {number} [opts.fetchTimeout] fetch timeout
 * @returns {Promise<ValidationResult>} the validation result
 */
export async function validateSource(ctx, info, opts) {
  const { config: { content }, log } = ctx;
  const source = opts?.source ?? content.source;
  const sourceUrl = new URL(source.url);
  const ret = {
    sourceUrl,
    org: info.org,
    site: info.site,
    sourcePath: info.resourcePath,
    error: null,
  };

  // extract org and site from url.pathname, format: https://api.aem.live/<org>/sites/<site>/source
  // e.g. /adobe/sites/foo/source
  const pathMatch = sourceUrl.pathname.match(/^\/([^/]+)\/sites\/([^/]+)\/source$/);
  if (!pathMatch) {
    ret.error = errorResponse(log, 400, error(
      'Source url must be in the format: https://api.aem.live/<org>/sites/<site>/source. Got: $1',
      sourceUrl.href,
    ));
  } else {
    const [, org, site] = pathMatch; // eslint-disable-line prefer-destructuring
    if (org !== info.org || site !== info.site) {
      ret.error = errorResponse(log, 400, error(
        'Source bus is not allowed for org: $1, site: $2',
        org,
        site,
      ));
    }
  }

  // for now, only allow source bus from the same org and site
  return ret;
}
