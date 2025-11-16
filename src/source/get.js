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
import { HelixStorage } from '@adobe/helix-shared-storage';
import { createErrorResponse } from '../contentbus/utils.js';

function getHeaders(meta, length, id) {
  const headers = {
    'Content-Type': meta.ContentType,
    'Last-Modified': meta.LastModified.toUTCString(),
    'X-da-id': id,
  };
  if (length) {
    headers['Content-Length'] = length;
  }
  if (meta.ETag) {
    headers.ETag = meta.ETag;
  }
  return headers;
}

async function accessSource(context, info, headOnly) {
  const { log } = context;

  const storage = HelixStorage.fromContext(context);
  const bucket = storage.sourceBus();

  const { org, site, resourcePath: key } = info;
  const path = `${org}/${site}${key}`;

  try {
    if (headOnly) {
      const head = await bucket.head(path);
      if (!head) {
        return new Response('', { status: 404 });
      } else {
        const headers = getHeaders(head, head.ContentLength, head.Metadata.id);
        return new Response('', { status: head.$metadata.httpStatusCode, headers });
      }
    } else {
      const meta = {};
      const body = await bucket.get(path, meta);
      if (!body) {
        return new Response('', { status: 404 });
      } else {
        const headers = getHeaders(meta, body.length, meta.id);
        return new Response(body, { status: 200, headers });
      }
    }
  } catch (e) {
    const opts = { e, log };
    opts.status = e?.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}

export async function getSource(context, info) {
  return accessSource(context, info, false);
}

export async function headSource(context, info) {
  return accessSource(context, info, true);
}
