/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { Response } from '@adobe/fetch';
import remove from './remove.js';
import status from './status.js';
import update from './update.js';
import { fetchExtendedIndex } from './utils.js';

const ALLOWED_METHODS = ['GET', 'POST', 'DELETE'];

/**
 * Handles the index route.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function indexHandler(context, info) {
  const { log, attributes: { authInfo } } = context;
  const { org, site, webPath } = info;

  if (ALLOWED_METHODS.indexOf(info.method) < 0) {
    return new Response('method not allowed', {
      status: 405,
    });
  }

  let index;
  try {
    index = await fetchExtendedIndex(context, info);
  } catch (e) {
    log.warn(`Unable to fetch index: ${e.message}`);
  }
  if (!index) {
    return new Response('', {
      status: 404,
      headers: {
        'x-error': `no index configuration could be loaded for document ${org}/${site}${webPath}`,
      },
    });
  }

  authInfo.assertPermissions('index:read');
  if (info.method === 'GET') {
    return status(context, info, index);
  }

  authInfo.assertPermissions('index:write');
  if (info.method === 'POST') {
    return update(context, info, index);
  }
  return remove(context, info, index);
}
