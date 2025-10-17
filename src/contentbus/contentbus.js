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
 * Returns the content bus info for the given resource. If the resource is missing, it will not
 * have a contentType.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} partition content bus partition
 * @returns {Promise<import('./contentbus.js').ContentBusResource>} a resource
 */
export async function getContentBusInfo(context, info, partition) {
  const { attributes } = context;
  const { content: { contentBusId, source: { type } } } = attributes.config;

  const key = `${contentBusId}/${partition}${info.resourcePath}`;
  const resp = await fetchS3(context, 'content', key, true);
  const ret = {
    status: resp.status,
    contentBusId: `${attributes.bucketMap.content}/${key}`,
  };
  if (resp.ok) {
    ret.contentType = resp.headers.get('content-type');
    ret.lastModified = resp.headers.get('last-modified');
    ret.sourceLocation = resp.headers.get('x-source-location');
    ret.sourceLastModified = resp.headers.get('x-source-last-modified') || undefined;
    ret.sheetNames = resp.headers.get('x-sheet-names') || undefined;
    ret.redirectLocation = resp.headers.get('redirect-location') || undefined;

    if (partition === 'preview' && info.resourcePath.startsWith('/.snapshots/')) {
      ret.lastPreviewed = resp.headers.get('x-last-previewed') || undefined;
      ret.lastPublished = resp.headers.get('x-last-published') || undefined;
    }

    if (!ret.sourceLocation && type) {
      ret.sourceLocation = `${type}:*`;
    }
    if (attributes.authInfo?.hasPermissions('log:read')) {
      ret.lastModifiedBy = resp.headers.get('x-last-modified-by') || undefined;
    }
  } else if (resp.status !== 404) {
    ret.error = resp.headers.get('x-error');
  }

  return ret;
}
