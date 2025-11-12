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

export class GoogleNock {
  constructor(nocker, content) {
    this.nocker = nocker;

    const { contentBusId, source } = content;
    const rootId = source.id;
    const sourceUrl = new URL(source.url);

    Object.assign(this, {
      contentBusId, rootId, source, sourceUrl,
    });
  }

  user(contentBusId = this.contentBusId, cacheData = {
    refresh_token: 'dummy-refresh-token',
    access_token: 'dummy-access-token',
  }) {
    const { nocker } = this;

    nocker.content(contentBusId)
      .head('/.helix-auth/auth-google-content.json')
      .optionally(contentBusId === 'default')
      .reply(200)
      .getObject('/.helix-auth/auth-google-content.json')
      .reply(200, S3CachePlugin.encrypt(
        contentBusId,
        JSON.stringify(cacheData),
      ))
      .putObject('/.helix-auth/auth-google-content.json')
      .optionally()
      .reply(200);
    return this;
  }

  #children(files, id, cond) {
    const { nocker } = this;

    const scope = nocker('https://www.googleapis.com')
      .get('/drive/v3/files')
      .query({
        q: `'${id}' in parents and trashed=false and mimeType ${cond}`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
        pageSize: 1000,
      });
    if (!files) {
      return scope;
    }
    scope.reply(200, { files });
    return this;
  }

  folders(files, id = this.rootId) {
    return this.#children(files, id, '= \'application/vnd.google-apps.folder\'');
  }

  sheets(files, id = this.rootId) {
    return this.#children(files, id, '= \'application/vnd.google-apps.spreadsheet\'');
  }

  documents(files, id = this.rootId) {
    return this.#children(files, id, '= \'application/vnd.google-apps.document\'');
  }

  files(files, id = this.rootId) {
    return this.#children(files, id, '!= \'application/vnd.google-apps.folder\'');
  }

  item(id, file) {
    const { nocker } = this;
    const scope = nocker('https://www.googleapis.com')
      .get(`/drive/v3/files/${id}`)
      .query({
        fields: 'name,parents,mimeType,modifiedTime',
        supportsAllDrives: 'true',
      });
    if (file) {
      scope.reply(200, file);
      return this;
    }
    return scope;
  }

  file(id, file) {
    const { nocker } = this;
    const scope = nocker('https://www.googleapis.com')
      .get(`/drive/v3/files/${id}`)
      .query({
        alt: 'media',
        supportsAllDrives: 'true',
      });
    if (file) {
      scope.reply(200, file);
      return this;
    }
    return scope;
  }
}
