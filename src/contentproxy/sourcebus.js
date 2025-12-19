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
import { MediaHandler, SizeTooLargeException } from '@adobe/helix-mediahandler';
import { ConstraintsError, html2md, TooManyImagesError } from '@adobe/helix-html2md';
import { Response } from '@adobe/fetch';
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';

const DEFAULT_MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20mb

const DEFAULT_MAX_IMAGES = 200;

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
    /* c8 ignore next 7 */
  } else {
    // this should never happen, since all resourcePaths are properly mapped before
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

  const {
    MEDIAHANDLER_NOCACHHE: noCache,
    CLOUDFLARE_ACCOUNT_ID: r2AccountId,
    CLOUDFLARE_R2_ACCESS_KEY_ID: r2AccessKeyId,
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: r2SecretAccessKey,
  } = ctx.env;

  const mediaHandler = new MediaHandler({
    r2AccountId,
    r2AccessKeyId,
    r2SecretAccessKey,
    bucketId: ctx.attributes.bucketMap.media,
    owner: org,
    repo: site,
    ref: 'main',
    contentBusId: content.contentBusId,
    log,
    noCache,
    fetchTimeout: 5000, // limit image fetches to 5s
    forceHttp1: true,
    maxSize: limits?.html2md?.maxImageSize ?? DEFAULT_MAX_IMAGE_SIZE,
  });

  const maxImages = limits?.html2md?.maxImages ?? DEFAULT_MAX_IMAGES;
  try {
    // convert to md
    const md = await html2md(body, {
      mediaHandler,
      log,
      url: sourceUrl.href + sourcePath, // only used for logging
      org,
      site,
      unspreadLists: true,
      maxImages,
      externalImageUrlPrefixes: [`https://main--${site}--${org}.aem.page/`],
    });

    return new Response(md, {
      status: 200,
      headers: {
        'content-type': 'text/markdown',
        'last-modified': meta.LastModified?.toUTCString(),
      },
    });
  } catch (e) {
    if (e instanceof TooManyImagesError) {
      return errorResponse(log, 409, error(
        'Unable to preview \'$1\': Documents has more than $2 images: $3',
        sourcePath,
        maxImages,
        e.message, // todo: include num images in error
      ));
    }
    if (e instanceof SizeTooLargeException) {
      return errorResponse(log, 409, error(
        'Unable to preview \'$1\': $2',
        sourcePath,
        e.message,
      ));
    }
    /* c8 ignore next 6 */
    return errorResponse(log, 500, error(
      'Unable to preview \'$1\': $2',
      sourcePath,
      e.message,
    ));
  }
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
