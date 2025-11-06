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
import preview from './preview.js';
import status from './status.js';
import { errorResponse, isIllegalPath } from '../support/utils.js';

const ALLOWED_METHODS = ['GET', 'POST'];

/**
 * Handles the preview route.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function previewHandler(context, info) {
  const { log, attributes: { authInfo } } = context;

  if (ALLOWED_METHODS.indexOf(info.method) < 0) {
    return new Response('method not allowed', {
      status: 405,
    });
  }
  if (info.method !== 'DELETE' && isIllegalPath(info.webPath, true)) {
    return errorResponse(log, 400, `illegal path: ${info.webPath}`);
  }
  authInfo.assertPermissions('preview:read');

  if (info.method === 'GET') {
    return status(context, info);
  }

  authInfo.assertPermissions('preview:write');
  return preview(context, info);
}
