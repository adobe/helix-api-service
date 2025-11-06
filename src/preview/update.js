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
import purge from '../cache/purge.js';
import { getUserListPaths } from '../config/utils.js';
import { getMetadataPaths } from '../contentbus/contentbus.js';
import contentbusUpdate from '../contentbus/update.js';
import { updateRedirect } from '../redirects/update.js';
import previewStatus from './status.js';

/**
 * Updates a resource by invoking the content proxy and storing the content in the content bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 *
 * @returns {Promise<Response>} response
 */
export default async function update(context, info) {
  const { log } = context;

  log.info('updating preview in content-bus.');
  const response = await contentbusUpdate(context, info);

  // check if redirect overwrites the content
  const sourceRedirectLocation = await updateRedirect(context, info);

  let { status } = response;
  if (!response.ok) {
    // handle redirects
    if (status === 404) {
      // tweak status if existing redirect
      if (sourceRedirectLocation) {
        status = 200;
      } else {
        return response;
      }
    }
    if (status !== 304 && status !== 200) {
      status = propagateStatusCode(status);
      const level = logLevelForStatusCode(status);
      const headers = ['x-error', 'x-error-code', 'x-severity'].reduce((p, name) => {
        if (response.headers.has(name)) {
          // eslint-disable-next-line no-param-reassign
          p[name] = response.headers.get(name);
        }
        return p;
      }, {});

      const err = response.headers.get('x-error');
      log[level](`error from content bus: ${response.status} ${err}`);

      return new Response('error from content-bus', { status, headers });
    }
  }

  // TODO: update snapshot if the previewed resource is in a snapshot
  // if (/^\/\.snapshots\/[A-Za-z0-9-_]+\//.test(info.rawPath)) {
  // eslint-disable-next-line max-len
  //   const snapshotId = info.rawPath.substring(SNAPSHOT_DIR.length, info.rawPath.indexOf('/', SNAPSHOT_DIR.length));
  //   const snapInfo = info.cloneWithPath(info.rawPath, {
  //     route: 'snapshot',
  //     snapshotId,
  //     ref: 'main',
  //     method: 'POST',
  //   });
  //   await snapshotHandler(ctx, snapInfo);
  // }

  // check if metadata was updated for a helix5 project
  if (getMetadataPaths(context).includes(info.webPath)
      || (await getUserListPaths(context, info)).includes(info.webPath)) {
    await purge.config(context, info);
  }
  return previewStatus(context, info);
}
