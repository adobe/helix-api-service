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
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Get the content type from the extension.
 *
 * @param {string} ext extension
 * @return {string} content type
 * @throws {Error} with $metadata.httpStatusCode 400 if the content type is not found
 */
export function contentTypeFromExtension(ext) {
  const contentType = CONTENT_TYPES[ext.toLowerCase()];
  if (contentType) {
    return contentType;
  }
  const e = new Error(`Unknown file type: ${ext}`);
  e.$metadata = { httpStatusCode: 415 };
  throw e;
}

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
export function getSourceKey(info) {
  const { org, site, resourcePath } = info;
  return getS3Key(org, site, resourcePath);
}
