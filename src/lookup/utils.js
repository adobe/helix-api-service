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
import web2edit from './web2edit.js';

/**
 * Ensure source document does not exist anymore.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function assertSourceGone(context, info) {
  const { log } = context;
  const { org, site, resourcePath } = info;

  const result = await web2edit(context, info);
  if (result.error && result.status !== 404) {
    return new Response('', {
      status: result.status,
      headers: {
        'x-error': result.error,
      },
    });
  }
  if (result.editUrl) {
    log.warn(`rejecting deletion of /${org}/${site}${resourcePath} since source document still exists.`);
    return new Response('', {
      status: 403,
      headers: {
        'x-error': 'delete not allowed while source exists.',
      },
    });
  }
  return new Response();
}
