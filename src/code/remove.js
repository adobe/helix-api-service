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
import { Response } from '@adobe/fetch';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { createErrorResponse } from '../contentbus/utils.js';

/**
 * Removes a resource from the code-bus
 * @param {AdminContext} ctx context
 * @param {PathInfo} info path info
 * @returns {Promise<Response>} response
 */
export default async function codeRemove(ctx, info) {
  const { log } = ctx;
  const {
    owner, repo, ref, resourcePath,
  } = info;
  try {
    const contentStorage = HelixStorage.fromContext(ctx).codeBus();
    await contentStorage.remove(`${owner}/${repo}/${ref}${resourcePath}`);
    if (ref === 'main' && resourcePath === '/fstab.yaml') {
      await contentStorage.remove(`${owner}/${repo}/main/helix-config.json`);
    }
    return new Response('', {
      status: 204,
    });
    /* c8 ignore next 4 */
  } catch (e) {
    log.error(`error from code bus: ${e.message}`);
    return createErrorResponse({ e, log });
  }
}
