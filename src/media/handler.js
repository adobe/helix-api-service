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
import { Response, timeoutSignal } from '@adobe/fetch';
import { MediaHandler } from '@adobe/helix-mediahandler';
import { MEDIA_TYPES } from './validate.js';
import { errorResponse } from '../support/utils.js';

/**
 * Allowed methods for that handler.
 */
const ALLOWED_METHODS = ['POST'];

/**
 * Fetch timeout for media files.
 */
const FETCH_TIMEOUT = 10_000;

/**
 * Fetch media.
 */
async function fetchMedia(context, url) {
  const { log } = context;

  const fetch = context.getFetch();
  const opts = {
    method: 'GET',
    headers: {
      'accept-encoding': 'identity',
      accept: 'image/jpeg,image/jpg,image/png,image/gif,video/mp4,application/xml,image/x-icon,image/avif,image/webp,*/*;q=0.8',
    },
    cache: 'no-store',
    signal: timeoutSignal(FETCH_TIMEOUT),
  };

  try {
    const res = await fetch(url, opts);
    const body = await res.buffer();

    log.debug(`Fetched media at: ${url}`, {
      statusCode: res.status,
      headers: res.headers.plain(),
    });
    if (!res.ok) {
      return { error: `Failed to fetch media at: ${url}: ${res.status}` };
    }
    return { body, contentType: res.headers.get('content-type') };
  } catch (e) {
    return { error: `Failed to fetch media at: ${url}: ${e.message}` };
    /* c8 ignore next 3 */
  } finally {
    opts.signal.clear();
  }
}

/**
 * Upload to media bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response
 */
async function upload(context, info) {
  const { log, attributes: { config } } = context;

  const { headers, org, site } = info;
  const {
    CLOUDFLARE_ACCOUNT_ID: r2AccountId,
    CLOUDFLARE_R2_ACCESS_KEY_ID: r2AccessKeyId,
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: r2SecretAccessKey,
  } = context.env;

  const { content: { contentBusId } } = config;
  const mh = new MediaHandler({
    r2AccountId,
    r2AccessKeyId,
    r2SecretAccessKey,
    bucketId: context.attributes.bucketMap.media,
    owner: org,
    repo: site,
    ref: 'main',
    contentBusId,
    log,
  });

  let body;

  // fetch media body, either from URL or directly
  let contentType = headers['content-type'];
  if (contentType === 'application/x-www-form-urlencoded' || contentType === 'application/json') {
    const { url } = context.data;
    if (!url) {
      return new Response('', { status: 400, headers: { 'x-error': 'missing URL' } });
    }
    const ret = await fetchMedia(context, url);
    if (ret.error) {
      return errorResponse(log, 502, ret.error);
    }
    ({ body, contentType } = ret);
  } else {
    body = await info.buffer();
    if (body.length === 0) {
      return new Response('', { status: 400, headers: { 'x-error': 'missing media in request body' } });
    }
  }

  // preprocess and validate media
  const mediaType = MEDIA_TYPES.find((type) => type.mime === contentType);
  if (mediaType) {
    const { preprocess, validate } = mediaType;
    if (preprocess) {
      body = await preprocess(body, log);
    }
    if (validate) {
      try {
        await validate(context, 'unnamed', body);
      } catch (e) {
        return errorResponse(log, 409, e.reason);
      }
    }
  }

  // upload to media bus
  const blob = mh.createMediaResource(body, null, contentType);
  await mh.put(blob);

  const { meta, uri } = blob;

  return new Response(JSON.stringify({
    uri,
    meta: {
      type: blob.contentType,
      ...Object.fromEntries(Object.entries(meta).filter(([key]) => ['width', 'height'].includes(key))),
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * Handles the media route
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response
 */
export default async function mediaHandler(context, info) {
  const { attributes: { authInfo } } = context;

  if (ALLOWED_METHODS.indexOf(info.method) < 0) {
    return new Response('method not allowed', {
      status: 405,
    });
  }
  authInfo.assertPermissions('media:upload');
  return upload(context, info);
}
