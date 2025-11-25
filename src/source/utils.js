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
 * Known content types for the source bus.
 */
export const CONTENT_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html',
};

/**
 * Get the S3 path from the organization, site, and key.
 *
 * @param {string} org organization
 * @param {string} site site
 * @param {string} key document key
 * @returns {string} the S3 path
 */
export function getS3Path(org, site, key) {
  return `${org}/${site}${key}`;
}

/**
 * Get the source bus path from the request info.
 *
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {string} the source bus path
 */
export function getSourcePath(info) {
  const { org, site, resourcePath: key } = info;
  return getS3Path(org, site, key);
}
