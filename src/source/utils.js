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

import { Response } from '@adobe/fetch';
import { MediaHandler } from '@adobe/helix-mediahandler';
import processQueue from '@adobe/helix-shared-process-queue';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { fromHtml } from 'hast-util-from-html';
import { select } from 'hast-util-select';
import { toHtml } from 'hast-util-to-html';
import { visit, CONTINUE } from 'unist-util-visit';
import { MEDIA_TYPES } from '../media/validate.js';
import { StatusCodeError } from '../support/StatusCodeError.js';

/**
 * We consider the following HTML errors to be acceptable and ignore them.
 */
const ACCEPTABLE_HTML_ERRORS = [
  'missing-doctype',
];

/**
 * Known content types for the source bus.
 */
export const CONTENT_TYPES = {
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Default maximum image size for the media bus.
 */
const DEFAULT_MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20mb

/**
 * Default maximum number of images for the media bus.
 */
const DEFAULT_MAX_IMAGES = 200;

/**
 * Error messages from the media validation often start with this prefix.
 */
const PREVIEW_ERROR_PREFIX = 'Unable to preview';

/**
 * Get the content type from the extension.
 *
 * @param {string} ext extension
 * @return {string} content type
 * @throws {Error} with $metadata.httpStatusCode 400 if the content type is not found
 */
export function contentTypeFromExtension(ext) {
  const contentType = CONTENT_TYPES[ext.toLowerCase()];
  if (contentType) {
    return contentType;
  }
  const e = new Error(`Unknown file type: ${ext}`);
  e.$metadata = { httpStatusCode: 415 };
  throw e;
}

/**
 * Get the HAST from the body.
 *
 * @param {Buffer} body the message body as buffer
 * @return {Hast} the HAST
 * @throws {StatusCodeError} with statusCode 400 if the HTML is invalid
 */
function getHast(body) {
  function validateHtmlError(message) {
    const msg = `${message.message} - ${message.note}`;
    if (ACCEPTABLE_HTML_ERRORS.includes(message.ruleId)) {
      return;
    }
    throw new StatusCodeError(msg, 400);
  }

  return fromHtml(body.toString(), {
    onerror: validateHtmlError,
  });
}

/**
 * Get the S3 key from the organization, site, and path.
 *
 * @param {string} org organization
 * @param {string} site site
 * @param {string} path document path
 * @returns {string} the S3 key
 */
export function getS3Key(org, site, path) {
  return `${org}/${site}${path}`;
}

/**
 * Get the source bus key from the request info.
 *
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {string} the source bus path
 */
export function getSourceKey(info) {
  const { org, site, resourcePath } = info;
  return getS3Key(org, site, resourcePath);
}

/**
 * Validate the HTML message body and intern the images if a media handler is provided.
 * When interning the images, they are uploaded to the media bus and references to them
 * are replaced with media bus URLs.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {Buffer} body the message body as buffer
 * @param {string[]} keptImageURLPrefixes prefixes of image URLs to keep
 * @param {MediaHandler} mediaHandler media handler. If provided, external images are
 * interned. If not provided, the HTML is not considered valid if it contains external
 * images.
 * @returns {Promise<Buffer>} the message body either as a buffer or a string,
 * potentially altered with links to the interned images.
 * @throws {StatusCodeError} with statusCode 400 if the HTML is invalid, does not contain
 * a body element, or contains external images and a media handler is not provided. Also
 * if the HTML contains too many images an error is thrown.
 */
export async function getValidHtml(context, body, keptImageURLPrefixes, mediaHandler) {
  // TODO Check HTML size limit

  /* The register() function populates the images map with the nodes that need to be
     interned. It is called for each img and picture->source element in the HTML. */
  const images = new Map();
  function register(node, propName) {
    const url = node.properties[propName] || '';
    const keepImageURL = keptImageURLPrefixes.some((prefix) => {
      if (typeof prefix === 'string') {
        return url.startsWith(prefix);
      }
      // it's a regex
      return prefix.test(url);
    });

    if (keepImageURL) {
      return;
    }

    if (images.has(url)) {
      images.get(url).push({ node, propName });
    } else {
      images.set(url, [{ node, propName }]);
    }
  }

  let bodyNode = null;
  const hast = getHast(body);

  const main = select('main', hast);
  if (!main) {
    throw new StatusCodeError('HTML does no contain a <main> element', 400);
  }

  visit(hast, 'element', (node) => {
    if (node.tagName === 'body') {
      bodyNode = node;
    }

    if (node.tagName === 'img') {
      register(node, 'src');
    }
    if (node.tagName === 'picture') {
      const sources = node.children.filter((child) => child.tagName === 'source');
      sources.forEach((s) => register(s, 'srcSet')); // note Hast converts srcset to srcSet
    }
    return CONTINUE;
  });

  if (!mediaHandler) {
    // If the media handler is not provided, we validate only and need to reject external images
    if (images.size > 0) {
      throw new StatusCodeError('External images are not allowed, use POST to intern them', 400);
    }
    return body;
  }

  if (images.size > DEFAULT_MAX_IMAGES) {
    throw new StatusCodeError(`Too many images: ${images.size}`, 400);
  }

  await processQueue(images.entries(), async ([url, nodes]) => {
    try {
      const blob = await mediaHandler.getBlob(url);
      nodes.forEach((n) => {
        // eslint-disable-next-line no-param-reassign
        n.node.properties[n.propName] = blob.uri || 'about:error';
      });
    } catch (e) {
      context.log.error(`Error getting blob for image: ${url}`, e);
      throw new StatusCodeError(`Error getting blob for image: ${url}`, 400);
    }
  });

  /* Only return the body element, note that Hast synthesizes this if it wasn't
     present in the input HTML. */
  return toHtml(bodyNode);
}

/**
 * Validate the JSON message body stored in the request info.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {Buffer} body the message body as buffer
 */
export async function validateJson(context, body) {
  // TODO check JSON size limit

  try {
    JSON.parse(body);
  } catch (e) {
    throw new StatusCodeError(`Invalid JSON: ${e.message}`, 400);
  }
}

/**
 * Validate media body stored in the request info.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} mime media type
 * @param {Buffer} body the message body as buffer
 * @returns {Promise<Buffer>} body the message body as buffer
 */
export async function validateMedia(context, info, mime, body) {
  const mediaType = MEDIA_TYPES.find((type) => type.mime === mime);
  if (!mediaType) {
    throw new StatusCodeError(`Unknown media type: ${mime}`, 400);
  }
  try {
    await mediaType.validate(context, info.resourcePath, body);
  } catch (e) {
    let msg = e.message;
    if (msg.startsWith(PREVIEW_ERROR_PREFIX)) {
      // Change the error message to not mention preview
      msg = msg.replace(PREVIEW_ERROR_PREFIX, 'Media not accepted');
    }

    throw new StatusCodeError(msg, 400, e.code);
  }
}

function getMediaHandler(ctx, info) {
  const noCache = false;
  const { log } = ctx;

  return new MediaHandler({
    bucketId: ctx.attributes.bucketMap.media,
    owner: info.org,
    repo: info.site,
    ref: 'main',
    contentBusId: ctx.attributes.config.content.contentBusId,
    log,
    noCache,
    fetchTimeout: 5000, // limit image fetches to 5s
    forceHttp1: true,
    maxSize: DEFAULT_MAX_IMAGE_SIZE,
  });
}

/** Get the prefixes of image URLs to keep.
 *
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {string[]} the prefixes of image URLs to keep, either as string or regex
 */
function getKeptImageURLPrefixes(info) {
  return [
    `https://main--${info.site}--${info.org}.aem.page/`,
    `https://main--${info.site}--${info.org}.aem.live/`,

    // Allow any host for Dynamic Media Delivery URLs
    /^https:\/\/[^/]+\/adobe\/dynamicmedia\/deliver\//,
  ];
}

/**
 * Validate the body stored in the request info.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} mime media type
 * @returns {Promise<Buffer>} body the message body as buffer or string
 */
export async function getValidPayload(context, info, mime, internImages) {
  const body = await info.buffer();

  switch (mime) {
    case 'text/html':
      // This may change the HTML (interning the images) so return its result
      return getValidHtml(
        context,
        body,
        getKeptImageURLPrefixes(info),
        internImages ? getMediaHandler(context, info) : null,
      );
    case 'application/json':
      await validateJson(context, body);
      break;
    default:
      await validateMedia(context, info, mime, body);
      break;
  }
  return body;
}

/**
 * Get the user from the context and return their email.
 * If no user is found, return 'anonymous'.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @return {string} user or 'anonymous'
 */
function getUser(context) {
  const email = context.attributes.authInfo?.profile?.email;

  return email || 'anonymous';
}

/**
 * Store file based on key and body in the source bus.
 * The file is assumes already have been validated.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} key key to store the file at (including extension)
 * @param {string} mime the mime type of the file
 * @param {Buffer} body content body
 * @returns {Promise<Response>} response
 */
export async function storeSourceFile(context, key, mime, body) {
  const bucket = HelixStorage.fromContext(context).sourceBus();

  const resp = await bucket.put(key, body, mime, {
    'Last-Modified-By': getUser(context),
    'Uncompressed-Length': String(body.length),
  }, true);

  const status = resp.$metadata.httpStatusCode === 200 ? 201 : resp.$metadata.httpStatusCode;
  return new Response('', { status });
}
