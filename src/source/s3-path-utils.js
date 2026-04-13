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

/**
 * Get the S3 key from the organization, site, and path.
 *
 * @param {string} org organization
 * @param {string} site site
 * @param {string} path document path
 * @returns {string} the S3 key
 */
export function getS3Key(org, site, path) {
  return `${org}/${site}${path}`;
}

/**
 * Get the source bus key from the request info.
 *
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {string} the source bus path
 */
export function getS3KeyFromInfo(info) {
  const { org, site, resourcePath } = info;
  return getS3Key(org, site, resourcePath);
}

/**
 * Get the document path from the source bus S3 key.
 *
 * @param {string} sKey source bus S3 key
 * @returns {string} the document path
 */
export function getDocPathFromS3Key(sKey) {
  const path = sKey.split('/').slice(2).join('/');
  return `/${path}`;
}
