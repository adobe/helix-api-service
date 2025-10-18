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
import { getContentBusInfo } from '../contentbus/contentbus.js';
import { toResourcePath } from '../support/RequestInfo.js';

/**
 * Retrieves the preview status.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info info
 * @returns {Promise<object>} live info
 */
export default async function getPreviewInfo(context, info) {
  const { attributes: { authInfo } } = context;

  if (!authInfo.hasPermissions('preview:read')) {
    return {
      status: 403,
      url: info.getPreviewUrl(),
      error: 'forbidden',
    };
  }

  const resourcePath = toResourcePath(info.webPath);
  const redirects = await context.getRedirects('preview');

  return {
    url: info.getPreviewUrl(context, info),
    ...await getContentBusInfo(context, info, 'preview'),
    configRedirectLocation: redirects[resourcePath],
    permissions: authInfo.getPermissions('preview:'),
  };
}
