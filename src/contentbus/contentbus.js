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
import { coerceArray } from '../support/utils.js';

export const REDIRECTS_JSON_PATH = '/redirects.json';

export const CONFIG_JSON_PATH = '/.helix/config.json';

export const HEADERS_JSON_PATH = '/.helix/headers.json';

export const METADATA_JSON_PATH = '/metadata.json';

// the threshold for purging all content in case of a bulk preview/publish operation
// i.e. if more than 100 resources are touched, we purge all content
export const PURGE_ALL_CONTENT_THRESHOLD = 100;

/**
 * Returns the list of metadata paths that are configured. Falls back to the
 * `/metadata.json` if non configured.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @return {string[]}
 */
export function getMetadataPaths(context) {
  const { attributes: { config } } = context;
  return coerceArray(
    config?.metadata?.source
    || config?.data?.metadata
    || [METADATA_JSON_PATH],
  );
}

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
