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
import { HelixStorage } from '@adobe/helix-shared-storage';

<<<<<<< HEAD
<<<<<<< HEAD
=======
/**
 * Get the source bus bucket from the context.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @return {HelixStorage.Bucket} bucket
 */
export function getSourceBucket(context) {
  const storage = HelixStorage.fromContext(context);
  return storage.sourceBus();
}

export function getPath(org, site, key) {
  return `${org}/${site}${key}`;
}

>>>>>>> 53eee1e (test: initial tests for folder listing)
/**
 * Get the source bus path from the request info.
 *
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {string} the source bus path
 */
export function getSourcePath(info) {
  const { org, site, resourcePath: key } = info;
<<<<<<< HEAD
  return `${org}/${site}${key}`;
}
=======
export const CONTENT_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html',
};
>>>>>>> e3c9b68 (feat: support directory listing for source endpoint)
=======
  return getPath(org, site, key);
}
>>>>>>> 53eee1e (test: initial tests for folder listing)
