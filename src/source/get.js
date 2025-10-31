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
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getS3Config } from './utils.js';

export function buildGetInput(bucket, org, key) {
  return { Bucket: bucket, Key: `${org}${key}` };
}

export async function getSource(context, info, head = false) {
  const config = getS3Config(context);
  const client = new S3Client(config);

  const bucket = 'helix-source-bus-db'; // TODO

  const { org, resourcePath: key } = info;
  const input = buildGetInput(bucket, org, key);

  try {
    const command = head ? new HeadObjectCommand(input) : new GetObjectCommand(input);
    const resp = await client.send(command);

    const result = {
      status: resp.$metadata.httpStatusCode,
      contentType: resp.ContentType,
      contentLength: resp.ContentLength,
      metadata: {
        ...resp.Metadata,
        LastModified: resp.LastModified,
      },
      etag: resp.ETag,
    };

    if (!head) {
      result.body = resp.Body;
    }

    return result;
  } catch (e) {
    return { body: '', status: e.$metadata?.httpStatusCode || 404, contentLength: 0 };
  }
}
