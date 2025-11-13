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
import { putSource } from './put.js';
import { createErrorResponse } from '../contentbus/utils.js';

async function handle(context, info) {
  try {
    switch (info.method) {
      case 'GET':
        return await getSource({ context, info });
      case 'PUT':
        return await putSource({ context, info });
      // case 'DELETE':
      //   return deleteSource(context, info);
      case 'HEAD':
        return await getSource({ context, info, headOnly: true });
      default:
        return new Response('method not allowed', { status: 405 });
    }
  } catch (e) {
    const opts = {
      e,
      log: context.log,
      status: e?.$metadata?.httpStatusCode,
    };
    return createErrorResponse(opts);
  }
}

export default async function sourceHandler(context, info) {
  const resp = await handle(context, info);

  if (info.headers.get('origin')) {
    resp.headers.set('access-control-allow-headers', '*');
    resp.headers.set('access-control-allow-methods', 'HEAD, GET, PUT, DELETE');
    resp.headers.set('access-control-expose-headers', 'x-da-id');
  }

  return resp;
}
