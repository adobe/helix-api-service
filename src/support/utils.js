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
import { keepAliveNoCache, timeoutSignal } from '@adobe/fetch';

export function getFetch() {
  if (!this.attributes.fetchContext) {
    // eslint-disable-next-line no-param-reassign
    this.attributes.fetchContext = keepAliveNoCache({
      userAgent: 'adobe-fetch', // static user-agent for recorded tests
    });
  }
  return this.attributes.fetchContext.fetch;
}

export function getFetchOptions(opts) {
  const fetchopts = {
    headers: {
      'cache-control': 'no-cache', // respected by runtime
    },
  };
  if (this.requestId) {
    fetchopts.headers['x-request-id'] = this.requestId;
  }
  if (this.githubToken) {
    fetchopts.headers['x-github-token'] = this.githubToken;
  }
  if (opts?.fetchTimeout) {
    fetchopts.signal = timeoutSignal(opts.fetchTimeout);
    delete fetchopts.fetchTimeout;
  }
  if (opts?.lastModified) {
    fetchopts.headers['if-modified-since'] = opts.lastModified;
    delete fetchopts.lastModified;
  }
  return fetchopts;
}
