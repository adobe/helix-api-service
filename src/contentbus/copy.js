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
 * Copy a content resource from the preview to the live partition.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function copy(context, info) {
  const { attributes, contentBusId, log } = context;
  const { resourcePath } = info;

  try {
    const storage = HelixStorage.fromContext(context).contentBus();
    await storage.copy(
      `${contentBusId}/preview${resourcePath}`,
      `${contentBusId}/live${resourcePath}`,
      {
        addMetadata: {
          'x-last-modified-by': attributes.authInfo?.resolveEmail() || 'anonymous',
        },
      },
    );
    return new Response('', { status: 200 });
  /* c8 ignore next 3 */
  } catch (e) {
    return createErrorResponse({ e, log });
  }
}
