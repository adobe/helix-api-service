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
import { fetchS3 } from '@adobe/helix-admin-support';

/**
 * Returns the code bus info for the given resource. If the resource is missing, it will not
 * have a contentType.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 *
 * @returns {Promise<CodeBusResource>} a resource
 */
export async function getCodeBusInfo(context, info) {
  const { attributes: { authInfo, bucketMap: { code } } } = context;
  const {
    owner, repo, ref, rawPath,
  } = info;

  if (!authInfo.hasPermissions('code:read')) {
    return {
      status: 403,
    };
  }
  if (!info.rawPath) {
    return {
      status: 400,
      permissions: authInfo.getPermissions('code:'),
    };
  }

  const key = `${owner}/${repo}/${ref}${info.rawPath}`;
  const resp = await fetchS3(context, 'code', key, true);
  const ret = {
    status: resp.status,
    codeBusId: `${code}/${key}`,
    permissions: authInfo.getPermissions('code:'),
  };
  const { GH_RAW_URL = 'https://raw.githubusercontent.com' } = context.env;
  if (resp.ok) {
    ret.contentType = resp.headers.get('content-type');
    ret.lastModified = resp.headers.get('last-modified');
    ret.contentLength = resp.headers.get('x-source-content-length') || undefined;
    ret.sourceLastModified = resp.headers.get('x-source-last-modified') || undefined;
    ret.sourceLocation = `${GH_RAW_URL}/${owner}/${repo}/${ref}${rawPath}`;
  } else if (resp.status !== 404) {
    ret.error = resp.headers.get('x-error');
  }
  return ret;
}
