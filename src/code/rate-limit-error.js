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
import { StatusCodeError } from '../support/StatusCodeError.js';

export class RateLimitError extends StatusCodeError {
  /**
   * Constructs a RateLimitError.
   * @constructor
   * @param {string} msg Error message
   * @param {string|number} retryAfter nmber of seconds after which the request can be retried
   * @param {string|number} retryReset timestamp (epoch) at which the rate limits are reset
   */
  constructor(msg, retryAfter = 0, retryReset = 0) {
    super(msg, 429);
    const after = Number.parseInt(retryAfter || '0', 10) * 1000;
    if (after > 0) {
      this.retryAfter = Date.now() + after;
    } else {
      this.retryAfter = Number.parseInt(retryReset || '0', 10) * 1000;
    }
  }
}
