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

export async function getSource(context, info, headOnly = false) {
  const storage = getS3Storage(context);

  // const bucket = storage.sourceBus();
  const bucket = storage.bucket('helix-source-bus-db'); // TODO

  const { org, resourcePath: key } = info;
  const path = `${org}${key}`;

  try {
    if (headOnly) {
      const head = await bucket.head(path);

      return {
        status: head.$metadata.httpStatusCode,
        contentType: head.ContentType,
        contentLength: head.ContentLength,
        etag: head.ETag,
        lastModified: head.Metadata.timestamp,
        metadata: {
          id: head.Metadata.id,
        },
      };
    } else {
      const meta = {};
      const body = await bucket.get(path, meta);

      return {
        body,
        status: 200,
        contentType: meta.ContentType,
        contentLength: body.length,
        // etag: head.ETag, we don't have this one
        lastModified: meta.timestamp,
        metadata: {
          id: meta.id,
        },
      };
    }
  } catch (e) {
    return { body: '', status: e.$metadata?.httpStatusCode || 404, contentLength: 0 };
  }
}
