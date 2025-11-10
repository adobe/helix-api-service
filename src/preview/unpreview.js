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
import purge, { PURGE_PREVIEW } from '../cache/purge.js';
import { REDIRECTS_JSON_PATH } from '../contentbus/contentbus.js';
import contentbusRemove from '../contentbus/remove.js';
import { assertSourceGone } from '../lookup/utils.js';
import { updateRedirects } from '../redirects/update.js';

/**
 * Unpreview a resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function unpreview(context, info) {
  const { log, attributes: { authInfo } } = context;
  const { resourcePath } = info;

  if (!authInfo.hasPermissions('preview:delete-forced')) {
    const response = await assertSourceGone(context, info);
    if (!response.ok) {
      return response;
    }
  }

  // special handling for redirects
  let oldRedirects;
  if (resourcePath === REDIRECTS_JSON_PATH) {
    oldRedirects = await context.getRedirects('preview');
    delete context.attributes.redirects;
  }

  const response = await contentbusRemove(context, info, 'preview');
  if (!response.ok && response.status !== 404) {
    const err = response.headers.get('x-error');
    log.error(`error from content bus: ${response.status} ${err}`);
    return new Response('error from content-bus', {
      status: 502,
      headers: {
        'x-error': err,
      },
    });
  }
  if (response.status !== 204) {
    return response;
  }

  await purge.resource(context, info, PURGE_PREVIEW);

  if (oldRedirects) {
    await updateRedirects(context, 'preview', oldRedirects, {});
  }

  // TODO
  // if (!context.data?.disableNotifications) {
  //   await getNotifier(context).publish('resource-unpreviewed', info, {
  //     status: resp.status,
  //     resourcePath: info.resourcePath,
  //   });
  // }
  return response;
}
