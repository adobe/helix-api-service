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
import { keepAliveNoCache } from '@adobe/fetch';

export function getFetch(attributes) {
  if (!attributes.fetchContext) {
    // eslint-disable-next-line no-param-reassign
    attributes.fetchContext = keepAliveNoCache({
      userAgent: 'adobe-fetch', // static user-agent for recorded tests
    });
  }
  return attributes.fetchContext.fetch;
}

export function getFetchOptions() {
  const fetchopts = {
    headers: {
      'cache-control': 'no-cache', // respected by runtime
    },
  };
  return fetchopts;
}
