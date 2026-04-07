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
import { BaseHandler } from './Handler.js';

class OrgHandler extends BaseHandler {
  constructor() {
    super('org', { supportsApiKeys: true });
  }

  determineConfigType(info) {
    const { rawPath, route } = info;
    if (rawPath === undefined) {
      // either a request to the org config itself or its sites or its profiles
      const type = route !== 'config.json' ? route : this.type;
      return { type };
    }
    const [, ...rest] = rawPath.substring(0, rawPath.length - 5).split('/');
    return { type: this.type, name: '', rest };
  }
}

const orgHandler = new OrgHandler();
export default orgHandler.handle.bind(orgHandler);
