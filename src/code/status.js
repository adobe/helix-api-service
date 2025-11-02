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
import { getCodeBusInfo } from './info.js';
import { StatusCodeError } from '../support/StatusCodeError.js';

/**
 * Updates a code resource by fetching the content from github and storing it in the code-bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function status(context, info) {
  const {
    owner, repo, ref, resourcePath,
  } = info;

  const codeInfo = await getCodeBusInfo(context, info);
  if (codeInfo.status === 404) {
    return new Response('', {
      status: 404,
    });
  }
  if (codeInfo.status !== 200) {
    throw new StatusCodeError(codeInfo.error, codeInfo.status);
  }

  const resp = {
    webPath: info.resourcePath,
    resourcePath: info.resourcePath,
    code: codeInfo,
    live: {
      url: info.getLiveUrl(),
    },
    preview: {
      url: info.getPreviewUrl(),
    },
    edit: {
      url: `https://github.com/${owner}/${repo}/edit/${ref}${resourcePath}`,
    },
    // TODO: should be derived from route
    // links: getAPIUrls(ctx, info, 'status', 'preview', 'live', 'code'),
  };

  return new Response(JSON.stringify(resp, null, 2), {
    headers: {
      'content-type': 'application/json',
    },
  });
}
