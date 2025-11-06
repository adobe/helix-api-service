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
import purge, { PURGE_PREVIEW } from '../cache/purge.js';
import { REDIRECTS_JSON_PATH } from '../contentbus/contentbus.js';
import { updateRedirects } from '../redirects/update.js';
import update from './update.js';

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

  // special handling for redirects
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

  const resp = await update(context, info);
  if (resp.status !== 200) {
    return resp;
  }

  await purge.resource(context, info, PURGE_PREVIEW);

  if (oldRedirects) {
    const newRedirects = await context.getRedirects('preview');
    const updated = await updateRedirects(context, 'preview', oldRedirects, newRedirects);
    await purge.redirects(context, info, updated, PURGE_PREVIEW);
  }

  // TODO
  // if (!context.data?.disableNotifications) {
  //   await getNotifier(context).publish('resource-previewed', info, {
  //     status: resp.status,
  //     resourcePath: info.resourcePath,
  //   });
  // }

  return resp;
}
