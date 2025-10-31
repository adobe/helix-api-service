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
import { getS3Storage } from './utils.js';
import { getSource } from './get.js';

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html',
};

function contentTypeFromExtension(ext) {
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

export async function putSource(context, info) {
  // Get object first
  const getResp = await getSource(context, info, true);
  const ID = getResp.metadata?.id || crypto.randomUUID();

  const storage = getS3Storage(context);

  // const bucket = storage.sourceBus();
  const bucket = storage.bucket('helix-source-bus-db'); // TODO

  const body = context.data.data; // TODO change
  const { org, resourcePath: key, ext } = info;
  const path = `${org}${key}`;
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
