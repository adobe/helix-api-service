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
import { getSource } from './get.js';
import { getS3Storage } from './utils.js';

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html',
};

function contentTypeFromExtension(ext) {
  const contentType = CONTENT_TYPES[ext];
  if (contentType) {
    return contentType;
  }
  const e = new Error(`Unknown file type: ${ext}`);
  e.$metadata = { httpStatusCode: 400 };
  throw e;
}

export async function putSource({ context, info, storage = getS3Storage(context) }) {
  const getResp = await getSource({
    context, info, headOnly: true, storage,
  });
  const existingId = context.data?.guid;
  if (existingId && getResp.metadata?.id && getResp.metadata?.id !== existingId) {
    return { body: `ID mismatch: ${existingId} !== ${getResp.metadata?.id}`, status: 409, metadata: { id: existingId } };
  }
  const ID = existingId || getResp.metadata?.id || crypto.randomUUID();

  const bucket = storage.sourceBus();

  const body = context.data?.data;
  const {
    org, resourcePath: key, site, ext,
  } = info;
  const path = `${org}/${site}${key}`;
  try {
    const resp = await bucket.put(path, body, contentTypeFromExtension(ext), {
      id: ID,
      timestamp: `${Date.now()}`,
    });
    return { status: resp.$metadata.httpStatusCode, metadata: { id: ID } };
  } catch (e) {
    return { status: e.$metadata?.httpStatusCode || 500, metadata: { id: ID } };
  }
}
