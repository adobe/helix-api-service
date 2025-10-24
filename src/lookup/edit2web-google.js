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
function test(source) {
  return source.type === 'google';
}

/**
 * Google URL decomposer.
 */
class GoogleURL {
  /**
   * Creates a new Google URL from a string.
   * @param {string} s google URL
   */
  constructor(s) {
    const url = new URL(s);
    if (url.protocol === 'gdrive:') {
      this._id = url.pathname;
    } else if (url.hostname === 'docs.google.com') {
      // https://docs.google.com/spreadsheets/d/1IDFZH5HVoYIg9siz1rK7d3hqAOeUpVc4WsgCdf2IMyA/edit
      // https://docs.google.com/document/d/1nbKakMrvDhf032da2hEYuxU30cdUmyZPv1kuRCKXiho/edit
      ([, this._type, , this._id] = url.pathname.split('/'));
    } else if (url.hostname === 'drive.google.com') {
      const segs = url.pathname.split('/');
      if (segs[2] === 'u') {
        ([, , , this._profile, this._type, this._id] = segs);
      } else {
        ([, , this._type, this._id] = segs);
      }
    }
  }

  get id() {
    return this._id;
  }

  get type() {
    return this._type;
  }

  get profile() {
    return this._profile;
  }

  getProfileSegment() {
    return this.profile ? `/u/${this.profile}` : '';
  }
}

/**
 * Returns the appropriate extension for a Google mime type.
 *
 * @param {string} mimeType mime type
 * @returns extension
 */
function getExtension(mimeType) {
  switch (mimeType) {
    case 'application/vnd.google-apps.spreadsheet':
      return '.json';
    case 'application/folder':
      return '';
    default:
      return '.md';
  }
}

/**
 * Performs a reverse lookup from an edit url to a web resource path
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} opts options
 * @param {string} opts.editUrl edit URL
 * @param {string} opts.contentBusId content bus id
 * @param {object} opts.source contentSource
 * @returns {Promise<LookupResponse>} lookup response
 */
async function lookup(context, info, opts) {
  const { log } = context;
  const { editUrl, contentBusId, source } = opts;

  const gurl = new GoogleURL(editUrl);
  log.debug(`type: ${gurl.type}, id: ${gurl.id}`);

  // get all the google mountpoints and their root ids
  const roots = {
    [source.id]: '/',
  };
  const client = await context.getGoogleClient(contentBusId);

  const hierarchy = await client.getItemsFromId(gurl.id, roots);
  if (hierarchy.length === 0 || hierarchy[0].path.startsWith('/root:/')) {
    throw new Error(`no such document: ${editUrl}`);
  }
  const item = hierarchy.shift();
  const editFolders = hierarchy.map((hItem) => ({
    name: hItem.name,
    url: `https://drive.google.com/drive${gurl.getProfileSegment()}/folders/${hItem.id}`,
    path: hItem.path,
  }));
  if (item.mimeType === 'application/vnd.google-apps.folder') {
    item.mimeType = 'application/folder';
  }

  const result = {
    status: 200,
    editUrl,
    resourcePath: decodeURIComponent(`${item.path}${getExtension(item.mimeType)}`),
    sourceLocation: `gdrive:${item.id}`,
    editFolders,
    editName: item.name,
    editContentType: item.mimeType,
  };
  if (item.lastModified) {
    result.sourceLastModified = new Date(item.lastModified).toUTCString();
  }
  return result;
}

export default {
  name: 'google',
  test,
  lookup,
};
