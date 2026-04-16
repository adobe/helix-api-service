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
import { generate } from './cdn-identifier.js';
import { reindexProject } from './reindex.js';
import { removeProject } from './remove.js';

const discover = {
  /**
   * Called when the configuration of a Helix 5 project has changed. Eventually
   * reindexes or removes the project from our inventory.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {object|null} oldConfig old configuration, may be `null`
   * @param {object|null} newConfig new configuration, may be `null`
   * @param {string} org org
   * @param {string} site site
   */
  projectChanged: async (context, oldConfig, newConfig, org, site) => {
    const { log } = context;

    if (oldConfig != null && newConfig === null) {
      // configuration removed, so remove project from discovery
      await removeProject(context, org, site);
      return;
    }
    if (oldConfig === null) {
      // configuration created, so add that project
      await reindexProject(context, org, site);
      return;
    }

    // at this point, we have both an old and a new configuration
    const signature = (config) => [
      config.content.contentBusId,
      config.code.owner,
      config.code.repo,
      generate(config)].join();
    const oldSig = signature(oldConfig);
    const newSig = signature(newConfig);
    if (oldSig !== newSig) {
      log.info(`[discover] project signature changed: ${oldSig} -> ${newSig}`);
      await reindexProject(context, org, site);
    } else {
      log.info(`[discover] project signature stable : ${oldSig}`);
    }
  },
};

export default discover;
