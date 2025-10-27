/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { S3CachePlugin } from '@adobe/helix-shared-tokencache';
import { OneDrive } from '@adobe/helix-onedrive-support';

export class OneDriveNock {
  constructor(nocker, content) {
    this.nocker = nocker;

    const { contentBusId, source } = content;
    const sourceUrl = new URL(source.url);

    Object.assign(this, {
      contentBusId, source, sourceUrl,
    });
  }

  user() {
    const { nocker, contentBusId } = this;

    nocker.content(contentBusId)
      .head('/.helix-auth/auth-onedrive-content.json')
      .optionally(contentBusId === 'default')
      .reply(200)
      .getObject('/.helix-auth/auth-onedrive-content.json')
      .reply(200, S3CachePlugin.encrypt(contentBusId, JSON.stringify({
        Account: {}, AccessToken: {}, RefreshToken: {}, IdToken: {}, AppMetadata: {},
      })))
      .putObject('/.helix-auth/auth-onedrive-content.json')
      .optionally()
      .reply(200);
    return this;
  }

  login(auth = {
    token_type: 'Bearer', refresh_token: 'dummy', access_token: 'dummy', expires_in: 181000,
  }, tenant = 'adobe') {
    const { nocker } = this;

    nocker('https://login.windows.net')
      .get(`/${tenant}.onmicrosoft.com/.well-known/openid-configuration`)
      .optionally(true)
      .reply(200, {
        issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
      });
    nocker('https://login.microsoftonline.com')
      .get(`/common/discovery/instance?api-version=1.1&authorization_endpoint=https://login.windows.net/${tenant}/oauth2/v2.0/authorize`)
      .optionally(true)
      .reply(200, {
        tenant_discovery_endpoint: `https://login.windows.net/${tenant}/v2.0/.well-known/openid-configuration`,
        'api-version': '1.1',
        metadata: [
          {
            preferred_network: 'login.microsoftonline.com',
            preferred_cache: 'login.windows.net',
            aliases: [
              'login.microsoftonline.com',
              'login.windows.net',
              'login.microsoft.com',
              'sts.windows.net',
            ],
          },
        ],
      })
      .get(`/${tenant}/v2.0/.well-known/openid-configuration`)
      .optionally(true)
      .reply(200, {
        token_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
        authorization_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        token_endpoint_auth_methods_supported: ['client_secret_post', 'private_key_jwt', 'client_secret_basic'],
        jwks_uri: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
        response_modes_supported: ['query', 'fragment', 'form_post'],
        subject_types_supported: ['pairwise'],
        id_token_signing_alg_values_supported: ['RS256'],
        response_types_supported: ['code', 'id_token', 'code id_token', 'id_token token'],
        scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      })
      .post(`/${tenant}/oauth2/v2.0/token`)
      .query((query) => {
        /* we only accept client-request-id or no query */
        if (query) {
          return Object.keys(query).every((key) => key === 'client-request-id');
        }
        return true;
      })
      .reply(200, auth);
    return this;
  }

  #resolveItem(sharingUrl, { id = 'share-id', mimeType = 'application/folder', webUrl = sharingUrl } = {}) {
    const { nocker } = this;

    const scope = nocker('https://graph.microsoft.com/v1.0')
      .get(`/shares/${OneDrive.encodeSharingUrl(sharingUrl)}/driveItem`);
    const result = {
      id,
      webUrl,
      parentReference: {
        id: 'folder-id',
        driveId: 'drive-id',
      },
    };
    if (mimeType === 'application/folder') {
      result.folder = {};
    } else {
      result.file = {
        mimeType,
      };
    }
    scope.reply(200, result);
    return this;
  }

  #resolveDoc(sharingUrl, { id = null } = {}) {
    const { nocker, sourceUrl } = this;

    const scope = nocker('https://graph.microsoft.com/v1.0')
      .get(`/shares/${OneDrive.encodeSharingUrl(sharingUrl)}/driveItem`);
    if (!id) {
      scope.reply(404);
    } else {
      const segs = sourceUrl.pathname.split('/');
      const webUrl = new URL(segs.slice(0, 3).join('/'), sourceUrl).href;

      scope.reply(200, {
        webUrl: `${webUrl}/_layouts/15/Doc.aspx?sourcedoc={${id}}`,
      });
    }
    return this;
  }

  resolve(path, opts) {
    const { sourceUrl } = this;

    const sharingUrl = path.startsWith('https://') ? path : `${sourceUrl}${path}`;
    const { pathname, searchParams } = new URL(sharingUrl);
    if (searchParams.has('share') || pathname.indexOf('/s/') !== -1) {
      return this.#resolveDoc(sharingUrl, opts);
    } else {
      return this.#resolveItem(sharingUrl, opts);
    }
  }

  #getFile(path, {
    id, lastModifiedDateTime, mimeType,
  } = {}) {
    const { nocker, sourceUrl } = this;

    const scope = nocker('https://graph.microsoft.com/v1.0')
      .get(`/drives/drive-id/items/share-id:${path}`);
    if (id === null) {
      scope.reply(404);
    } else {
      scope.reply(200, {
        file: {
          mimeType,
        },
        lastModifiedDateTime,
        name: path.split('/').at(-1),
        id,
        webUrl: `${sourceUrl}${path}`,
        parentReference: {
          id: 'folder-id',
          driveId: 'drive-id',
        },
      });
    }
    return this;
  }

  getSiteItem(site, itemId, {
    id, path, webUrl, lastModifiedDateTime = 'Thu, 08 Jul 2021 10:04:16 GMT',
  }) {
    const { nocker, sourceUrl } = this;
    const { hostname } = sourceUrl;

    const scope = nocker('https://graph.microsoft.com/v1.0')
      .get(`/sites/${hostname}:/${site}:/items/${itemId}`);
    if (id && path) {
      scope.reply(200, {
        name: path.split('/').at(-1),
        id,
        lastModifiedDateTime,
        webUrl: `${sourceUrl}${path}`,
        parentReference: {
          id: 'folder-id',
          driveId: 'drive-id',
        },
      });
    } else {
      scope.reply(200, {
        webUrl,
      });
    }
    return this;
  }

  getDocument(path, {
    id = 'document-id', lastModifiedDateTime = 'Thu, 08 Jul 2021 10:04:16 GMT',
  } = {}) {
    return this.#getFile(path, {
      id,
      lastModifiedDateTime,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  getWorkbook(path, {
    id = 'workbook-id', lastModifiedDateTime = 'Thu, 08 Jul 2021 10:04:16 GMT',
  } = {}) {
    return this.#getFile(path, {
      id,
      lastModifiedDateTime,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  getFolder(path, {
    id = 'folder-id', lastModifiedDateTime = 'Thu, 08 Jul 2021 10:04:16 GMT',
  } = {}) {
    const { nocker, sourceUrl } = this;

    const scope = nocker('https://graph.microsoft.com/v1.0')
      .get(`/drives/drive-id/items/${id}`);
    if (path === null) {
      scope.reply(404);
    } else {
      scope.reply(200, {
        webUrl: `${sourceUrl}${path}`,
        lastModifiedDateTime,
      });
    }
    return this;
  }

  getChildren(items) {
    const { nocker, sourceUrl } = this;

    nocker('https://graph.microsoft.com/v1.0')
      .get('/drives/drive-id/items/share-id/children')
      .query({
        $top: '999',
        $select: 'name,parentReference,file,id,size,webUrl,lastModifiedDateTime',
      })
      .reply(200, {
        value: items.map(({ path, id, lastModifiedDateTime }) => ({
          lastModifiedDateTime,
          file: true,
          name: path.split('/').at(-1),
          id,
          webUrl: `${sourceUrl}${path}`,
          parentReference: {
            id: 'folder-id',
            driveId: 'drive-id',
          },
        })),
      });
    return this;
  }
}
