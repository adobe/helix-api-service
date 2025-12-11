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
import { html2md } from '@adobe/helix-html2md';
import { Response } from '@adobe/fetch';
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';

/**
 * Retrieves a file from source bus.
 *
 * @param {import('../support/AdminContext').AdminContext} ctx context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} [opts] options
 * @param {object} [opts.source] content source
 * @param {string} [opts.lastModified] last modified
 * @param {number} [opts.fetchTimeout] fetch timeout
 * @returns {Promise<Response>} response
 */
async function handle(ctx, info, opts) {
  const { config: { content, limits }, log } = ctx;

  const source = opts?.source ?? content.source;
  const sourceUrl = new URL(source.url);
  // extract org and site from url.pathname, format: https://api.aem.live/<org>/sites/<site>/source
  // e.g. /adobe/sites/foo/source
  const pathMatch = sourceUrl.pathname.match(/^\/([^/]+)\/sites\/([^/]+)\/source$/);
  if (!pathMatch) {
    return errorResponse(log, 400, error(
      'Source url must be in the format: https://api.aem.live/<org>/sites/<site>/source. Got: $1',
      sourceUrl.href,
    ));
  }
  const [, org, site] = pathMatch; // eslint-disable-line prefer-destructuring

  // for now, only allow source bus from the same org and site
  if (org !== info.org || site !== info.site) {
    return errorResponse(log, 400, error(
      'Source bus is not allowed for org: $1, site: $2',
      org,
      site,
    ));
  }
  // the source is stored as .html files in the source bus
  let sourcePath = info.resourcePath;
  if (info.ext === '.md') {
    sourcePath = `${sourcePath.substring(0, sourcePath.length - '.md'.length)}.html`;
  } else if (!info.ext) {
    sourcePath += '.html';
  } else {
    return errorResponse(log, 400, error(
      'unexpected file extension: $1',
      info.ext,
    ));
  }

  // load content from source bus
  const sourceBus = HelixStorage.fromContext(ctx).sourceBus();
  const meta = {};
  const body = await sourceBus.get(`${org}/${site}${sourcePath}`, meta);
  if (!body) {
    return new Response('', { status: 404 });
  }

  // convert to md
  const md = await html2md(body, {
    mediaHandler: null,
    log,
    // url: sourceUrl,
    org,
    site,
    unspreadLists: true,
    maxImages: limits?.html2md?.maxImages,
  });

  return new Response(md, {
    status: 200,
    headers: {
      'content-type': 'text/markdown',
      'last-modified': meta.LastModified?.toUTCString(),
    },
  });
}

/**
 * @type {import('./contentproxy.js').ContentSourceHandler}
 */
export default {
  name: 'sourcebus',
  handle,
  handleJSON: () => { throw new Error('not implemented'); },
  handleFile: () => { throw new Error('not implemented'); },
  list: () => { throw new Error('not implemented'); },
};
