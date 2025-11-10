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
import { logLevelForStatusCode, propagateStatusCode } from '@adobe/helix-shared-utils';
import { getMetadataPaths } from '../contentbus/contentbus.js';
import contentBusCopy from '../contentbus/copy.js';
import { updateRedirect } from '../redirects/update.js';
import { hasSimpleSitemap } from '../sitemap/utils.js';
import publishStatus from './status.js';

/**
 * Publish a resource by invoking the content-bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function liveUpdate(context, info) {
  const { log } = context;

  // TODO: really?
  // const response = info.snapshotId
  //   ? await publishSnapshot(ctx, info)
  //   : await publish(ctx, info);

  log.info('updating live in content-bus.');
  const response = await contentBusCopy(context, info);

  // check if redirect overwrites the content
  const sourceRedirectLocation = await updateRedirect(context, info);

  let { status } = response;
  if (!response.ok) {
    // handle redirects
    if (status === 404) {
      // tweak status if existing redirect
      if (sourceRedirectLocation) {
        status = 200;
      }
    }
    if (status !== 304 && status !== 200) {
      status = propagateStatusCode(status);
      const level = logLevelForStatusCode(status);

      const err = response.headers.get('x-error');
      log[level](`error from content bus: ${response.status} ${err}`);
      return new Response('error from content-bus', {
        status,
        headers: {
          'x-error': err,
        },
      });
    }
  }

  if (getMetadataPaths(context).includes(info.webPath) && await hasSimpleSitemap(context, info)) {
    // TODO
    // await bulkIndex(context, info, ['/*'], {
    //   indexNames: ['#simple'],
    // });
  }
  return publishStatus(context, info);
}
