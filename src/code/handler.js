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
import { update } from './update.js';
import status from './status.js';
import remove from './remove.js';
import { errorResponse } from '../support/utils.js';
import purge from '../cache/purge.js';
import listBranches from './list-branches.js';
import { checkCanonicalRepo } from '../config/utils.js';
import { error } from '../contentproxy/errors.js';

/**
 * Allowed methods for that handler
 */
const ALLOWED_METHODS = ['GET', 'POST', 'DELETE'];

/**
 * Handles the code route
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<Response>} response
 */
export default async function codeHandler(context, info) {
  if (ALLOWED_METHODS.indexOf(info.method) < 0) {
    return new Response('method not allowed', {
      status: 405,
    });
  }

  const { log, attributes: { authInfo } } = context;

  const canonical = checkCanonicalRepo(context, info);
  if (canonical) {
    return errorResponse(log, 403, error(
      'Code operation restricted to canonical source: $1',
      canonical,
    ));
  }

  if (info.method === 'GET') {
    if (info.ref === '*') {
      return listBranches(context, info);
    }
    return status(context, info);
  }

  if (info.method === 'POST') {
    return update(context, info);
  }

  // DELETE
  authInfo.assertPermissions('code:delete');
  if (!authInfo.hasPermissions('code:delete-forced')) {
    log.warn(`rejecting deletion of /${info.owner}/sites/${info.repo}/code${info.resourcePath} when not authenticated.`);
    return new Response('', {
      status: 403,
      headers: {
        'x-error': 'delete not allowed if not authenticated.',
      },
    });
  }

  if (info.rawPath.endsWith('/*')) {
    return update(context, info);
  }

  const resp = await remove(context, info);
  if (resp.status !== 204) {
    return resp;
  }
  await purge.code(context, info, [info.resourcePath]);
  return resp;
}
