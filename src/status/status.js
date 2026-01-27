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
import { cleanupHeaderValue } from '@adobe/helix-shared-utils';
import { AccessDeniedError } from '../auth/AccessDeniedError.js';
import { LOGOUT_PATH } from '../auth/support.js';
import getLiveInfo from '../live/info.js';
import getPreviewInfo from '../preview/info.js';
import web2edit from '../lookup/web2edit.js';
import edit2web from '../lookup/edit2web.js';
import { RequestInfo } from '../support/RequestInfo.js';

/**
 * Handles GET status.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function status(context, info) {
  const { log, attributes: { authInfo } } = context;
  const { editUrl } = context.data;

  if (editUrl && editUrl !== 'auto' && info.webPath !== '/') {
    const msg = 'status lookup cannot have path and editUrl.';
    log.error(msg);
    return new Response('', {
      status: 400,
      headers: {
        'x-error': msg,
      },
    });
  }

  // calculate edit location
  const edit = {};
  let localinfo = info;
  let { resourcePath, webPath } = info;

  if (!authInfo.hasPermissions('edit:read')) {
    // if edit url is not auto, it can't be used as information for preview, live and code.
    // so we render them `403` as well.
    if (editUrl) {
      if (editUrl !== 'auto') {
        throw new AccessDeniedError('forbidden');
      }
    }
    edit.status = 403;
  } else {
    let result = {};
    if (editUrl) {
      if (editUrl === 'auto') {
        result = await web2edit(context, info);
      } else {
        result = await edit2web(context, info, editUrl);
      }
      /* c8 ignore start */
      if (result.error) {
        if ((result.status !== 404 && result.status !== 405) || editUrl !== 'auto') {
          const headers = {
            'x-error': cleanupHeaderValue(result.error),
          };
          if (result.severity) {
            headers['x-severity'] = result.severity;
          }
          return new Response('', { status: result.status, headers });
        }
      } else {
        localinfo = RequestInfo.clone(info, { path: result.webPath });
        resourcePath = result.resourcePath;
        webPath = result.webPath;

        edit.url = result.editUrl;
        edit.name = result.editName;
        edit.contentType = result.editContentType;
        edit.folders = result.editFolders;
        if (result.illegalPath) {
          edit.illegalPath = result.illegalPath;
        }
      }
      edit.lastModified = result.sourceLastModified;
      edit.sourceLocation = result.sourceLocation;
      edit.status = result.status;
    }
  }

  // adjust preview and live delete permissions, depending on edit status
  if (edit.status !== 404) {
    if (!authInfo.hasPermissions('preview:delete-forced')) {
      authInfo.removePermissions('preview:delete');
    }
    if (!authInfo.hasPermissions('live:delete-forced')) {
      authInfo.removePermissions('live:delete');
    }
    if (!authInfo.hasPermissions('code:delete-forced')) {
      authInfo.removePermissions('code:delete');
    }
  }

  const resp = {
    webPath,
    resourcePath,
    live: await getLiveInfo(context, localinfo),
    preview: await getPreviewInfo(context, localinfo),
    edit,
    links: localinfo.getAPIUrls('status', 'preview', 'live', 'code'),
  };

  if (authInfo.profile) {
    resp.profile = authInfo.profile;
  }
  if (authInfo.authenticated) {
    localinfo.getLinkUrl(LOGOUT_PATH);
  }

  return new Response(JSON.stringify(resp, null, 2), {
    headers: {
      'content-type': 'application/json',
    },
  });
}
