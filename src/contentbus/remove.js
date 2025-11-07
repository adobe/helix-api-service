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
import { createErrorResponse } from './utils.js';

/**
 * Removes a content resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} partition content bus partition of the file to remove
 * @returns {Promise<Response>} response
 */
export default async function remove(context, info, partition) {
  const { contentBusId, log } = context;
  const { resourcePath } = info;

  try {
    const storage = HelixStorage.fromContext(context).contentBus();
    const key = `${contentBusId}/${partition}${resourcePath}`;

    if (resourcePath.endsWith('.md')) {
      // preserve redirect location if already set on the content
      // redirects on assets are removed
      const metadata = await storage.metadata(key);
      const redirectLocation = metadata?.['redirect-location'];
      if (redirectLocation) {
        log.info(`removing ${key} from storage but keeping redirect object.`);
        await storage.put(key, Buffer.from(redirectLocation, 'utf-8'), 'text/plain', {
          'redirect-location': redirectLocation,
        }, false);
        return new Response('', { status: 204 });
      }
    }

    await storage.remove(key);
    return new Response('', {
      status: 204,
    });
    /* c8 ignore next 3 */
  } catch (e) {
    return createErrorResponse({ e, log });
  }
}
