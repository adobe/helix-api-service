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
import xml2js from 'xml2js';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { MediaHandler, SizeTooLargeException, maxSizeMediaFilter } from '@adobe/helix-mediahandler';
import { html2md, ImageUploadError, TooManyImagesError } from '@adobe/helix-html2md';
import { Response } from '@adobe/fetch';
import { toSISize } from '@adobe/helix-shared-string';
import { handleJSON } from './sourcebus-json.js';
import { handleFile } from './sourcebus-file.js';
import { list } from './SourcebusList.js';
import { validateSource } from './sourcebus-utils.js';
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';

const DEFAULT_MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20mb

const DEFAULT_MAX_SVG_SIZE = 40 * 1024;

const DEFAULT_MAX_IMAGES = 200;

/**
 * Buffer factor applied to limits to allow for format overhead.
 * A factor of 1.1 means we allow 10% over the documented limit.
 */
const LIMIT_BUFFER_FACTOR = 1.1;

/**
 * Error information with code and message.
 */
export class SVGValidationError extends Error {
  fatal = true;
}

/**
 * Validate SVG. Checks whether neither script tags nor on attributes are contained.
 * Note, this is similar to {@link ../media/Validate.js} but different enough
 * that combining them is tedious.
 *
 * @param {UniversalContext} ctx context
 * @param {Buffer} buf buffer
 * @param {number} limit svg size limit
 * @throws {SVGValidationError} if an error occurs
 */
export async function validateSVG(ctx, buf, limit) {
  const { log } = ctx;
  if (buf.byteLength > Math.ceil(limit * LIMIT_BUFFER_FACTOR)) {
    const $2 = toSISize(limit, 0);
    const $3 = toSISize(buf.byteLength, 1);

    throw new SVGValidationError(`SVG is larger than ${$2}: ${$3}`);
  }

  const checkForScriptOrHandlers = (node, path) => {
    const hasEventHandler = Object.keys(node.$ /* c8 ignore next */ ?? {})
      .some((attr) => attr.toLowerCase().startsWith('on'));

    if (node.script || hasEventHandler) {
      throw new SVGValidationError(`Script or event handler detected in SVG at: ${path}`);
    }
    Object.getOwnPropertyNames(node)
      .filter((name) => Array.isArray(node[name]))
      .forEach((name) => node[name].forEach((child, index) => checkForScriptOrHandlers(child, `${path}/${name}[${index}]`)));
  };

  let xml;

  try {
    xml = await xml2js.parseStringPromise(buf.toString('utf-8'), {
      strict: false, // allow escaped entity names, e.g. '&ns_extend;'
      normalizeTags: true, // lowercase all tag names
    });
    /* c8 ignore next 7 */
  } catch (e) {
    log.info(`Parsing SVG threw an error: ${e.message}`);
    throw new SVGValidationError('Unable to parse SVG XML');
  }
  if (!xml?.svg) {
    throw new SVGValidationError('Expected XML content with an SVG root item');
  }
  checkForScriptOrHandlers(xml.svg, '/svg');
}

/**
 * Creates a combined error message
 * @param {Error[]} errors
 * @returns {string}
 */
function createUploadErrorMessage(errors) {
  if (errors.length === 1) {
    const e = errors[0];
    if (e.error instanceof SizeTooLargeException) {
      return `Image ${e.idx} exceeds allowed limit of ${toSISize(e.error.limit)}`;
    }
    return `Image ${e.idx} failed validation: ${e.error.message}`;
  }
  const errorImages = errors.map(({ idx }) => idx).sort((a, b) => a - b);
  // eslint-disable-next-line max-len
  const stlErrors = errors.map(({ error: err }) => err).filter((e) => e?.limit > 0);
  if (stlErrors.length === errorImages.length) {
    return `Images ${errorImages.slice(0, -1).join(', ')} and ${errorImages.at(-1)} exceed allowed limit of ${toSISize(stlErrors[0].limit)}`;
  }
  return `Images ${errorImages.slice(0, -1).join(', ')} and ${errorImages.at(-1)} have failed validation.`;
}

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
  const {
    org, site, sourceUrl, error: errorResp,
  } = await validateSource(ctx, info, opts);
  if (errorResp) {
    return errorResp;
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

  const maxSize = limits?.preview?.maxImageSize
    ? parseInt(limits.preview.maxImageSize, 10)
    : DEFAULT_MAX_IMAGE_SIZE;

  const maxSVGSize = limits?.preview?.maxSVGSize
    ? parseInt(limits.preview.maxSVGSize, 10)
    : DEFAULT_MAX_SVG_SIZE;

  const contentFilter = async (blob) => {
    if (blob.data) {
      await validateSVG(ctx, blob.data, maxSVGSize);
    }
    return true;
  };

  const sizeFilter = maxSizeMediaFilter(maxSize);

  const resourceFilter = async (blob) => {
    const ct = blob.contentType /* c8 ignore next */ || '';
    if (!ct.startsWith('image/')) {
      return false;
    }
    // check size (throws is limit exceeded)
    await sizeFilter(blob);
    if (ct.startsWith('image/svg+xml')) {
      // return the content filter for svg
      return contentFilter;
    }
    return true;
  };

  const {
    MEDIAHANDLER_NOCACHE: noCache,
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
    filter: resourceFilter,
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
    if (e instanceof ImageUploadError) {
      return errorResponse(log, 409, error(
        'Unable to preview \'$1\': $2',
        sourcePath,
        createUploadErrorMessage(e.errors),
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
  handleJSON,
  handleFile,
  list,
};
