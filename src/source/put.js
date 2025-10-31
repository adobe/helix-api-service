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
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { buildGetInput } from './get.js';
import { getS3Config } from './utils.js';

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html',
};

function buildPutInput({
  bucket, org, key, body, ext, type,
}) {
  const bgi = buildGetInput(bucket, org, key);

  const ct = type || CONTENT_TYPES[ext] || 'application/octet-stream';
  bgi.Body = body;
  bgi.ContentType = ct;
  return bgi;
}

export async function putSource(context, info) {
  // Get object first

  const config = getS3Config(context);
  const client = new S3Client(config);

  const bucket = 'helix-source-bus-db';

  const { org, resourcePath: key, ext } = info;
  const obj = {
    data: context.data.data,
  };
  if (obj.data) {
    const inputConfig = {
      bucket, org, key, body: obj.data, ext,
    };
    const input = buildPutInput(inputConfig);

    const ID = crypto.randomUUID();
    const command = new PutObjectCommand({
      ...input,
      Metadata: {
        ID, /* Users, ?? */ Path: input.Key,
      },
    });
    try {
      const resp = await client.send(command);
      return { status: resp.$metadata.httpStatusCode, metadata: { id: ID } };
    } catch (e) {
      const status = e.$metadata?.httpStatusCode || 500;

      // eslint-disable-next-line no-console
      if (status >= 500) console.error('Object store failed', e);
      return { status, metadata: { id: ID } };
    }
  }
  return { status: 500 };
}
