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
import { BaseHandler } from './handler.js';

class ProfileHandler extends BaseHandler {
  constructor() {
    super('profiles');
  }

  determineConfigType(info) {
    const { rawPath, profile } = info;
    if (rawPath === undefined) {
      return {
        type: this.type, name: profile,
      };
    }
    const [, ...rest] = rawPath.substring(0, rawPath.length - 5).split('/');
    return { type: this.type, name: profile, rest };
  }

  async doHandle(context, info, op) {
    const { rawPath } = info;
    if (rawPath === '/robots.txt') {
      return this.handleRobots(context, info, op);
    }
    return super.doHandle(context, info, op);
  }
}

const profileHandler = new ProfileHandler();
export default profileHandler.handle.bind(profileHandler);
