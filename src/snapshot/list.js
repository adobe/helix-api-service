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

/**
 * Lists all snapshots for a site.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export async function listSnapshots(context, info) {
  const { contentBusId } = context;
  const dir = `${contentBusId}/preview/.snapshots/`;
  const bucket = HelixStorage.fromContext(context).contentBus();
  const paths = await bucket.listFolders(dir);
  const snapshots = paths.map((p) => p.slice(dir.length, -1));

  const body = {
    snapshots,
    links: {
      self: info.getLinkUrl(`/${info.org}/sites/${info.site}/snapshots`),
    },
  };

  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
  });
}
