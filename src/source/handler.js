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
import { getSource } from './get.js';
import { putSource } from './put.js';

async function handle(context, info) {
  try {
    switch (info.method) {
      case 'GET':
        return getSource({ context, info });
      case 'PUT':
        return putSource({ context, info });
      // case 'DELETE':
      //   return deleteSource(context, info);
      case 'HEAD':
        return getSource({context, info, headOnly: true });
      default:
        return {
          body: 'method not allowed',
          status: 405,
        };
    }
  } catch (e) {
    return {
      body: e.message,
      status: e.$metadata?.httpStatusCode || 500,
    };
  }
}

function addHeaderIfSet(headers, header, value) {
  if (value) {
    // eslint-disable-next-line no-param-reassign
    headers[header] = value;
  }
}

export default async function sourceHandler(context, info) {
  const resp = await handle(context, info);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'HEAD, GET, PUT, DELETE',
    'Access-Control-Expose-Headers': 'X-da-id',
  };
  addHeaderIfSet(headers, 'Content-Type', resp.contentType);
  addHeaderIfSet(headers, 'Content-Length', resp.contentLength);
  if (resp.lastModified) {
    headers['Last-Modified'] = new Date(Number(resp.lastModified)).toUTCString();
  }
  addHeaderIfSet(headers, 'ETag', resp.etag);
  addHeaderIfSet(headers, 'X-da-id', resp.metadata?.id);

  return new Response(resp.body, { status: resp.status, headers });
}
