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
import { parseBucketNames } from '@adobe/helix-shared-storage';

export class AdminContext {
  /**
   * @constructs AdminContext
   * @param {import('@adobe/helix-universal').UniversalContext} context universal context
   */
  constructor(context) {
    this.suffix = context.pathInfo.suffix;
    this.log = context.log;
    this.env = context.env;

    this.attributes = {
      errors: [],
      details: [],
      bucketMap: parseBucketNames(this.env.HELIX_BUCKET_NAMES),
    };
  }
}
