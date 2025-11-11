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
import purge, { PURGE_PREVIEW } from '../cache/purge.js';
import { getUserListPaths } from '../config/utils.js';
import { getMetadataPaths, REDIRECTS_JSON_PATH } from '../contentbus/contentbus.js';
import contentbusUpdate from '../contentbus/update.js';
import { updateRedirect, updateRedirects } from '../redirects/update.js';
import previewStatus from './status.js';

/**
 * Preview a resource by invoking the content-bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 *
 * @returns {Promise<Response>} response
 */
export async function previewUpdate(context, info) {
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

/**
 * Preview a resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function preview(context, info) {
  const { log, data: { forceUpdateRedirects } } = context;
  const { resourcePath } = info;

  let oldRedirects;
  if (resourcePath === REDIRECTS_JSON_PATH) {
    // if the update is forced, assume empty old redirects
    if (forceUpdateRedirects) {
      oldRedirects = {};
      log.warn('forcing update of redirects due to specified request parameter.');
    } else {
      oldRedirects = await context.getRedirects('preview');
      delete context.attributes.redirects;
    }
  }

  const response = await previewUpdate(context, info);
  if (response.status !== 200) {
    return response;
  }

  await purge.resource(context, info, PURGE_PREVIEW);

  if (oldRedirects) {
    const newRedirects = await context.getRedirects('preview');
    const updated = await updateRedirects(context, 'preview', oldRedirects, newRedirects);
    await purge.redirects(context, info, updated, PURGE_PREVIEW);
  }

  // TODO if (!context.data?.disableNotifications) {
  //   await getNotifier(context).publish('resource-previewed', info, {
  //     status: resp.status,
  //     resourcePath: info.resourcePath,
  //   });
  // }

  return response;
}
