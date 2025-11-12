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
import { HelixStorage } from '@adobe/helix-shared-storage';
import { getSource } from './get.js';

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html',
};

function contentTypeFromExtension(ext) {
  const contentType = CONTENT_TYPES[ext];
  if (contentType) {
    return contentType;
  }
  const e = new Error(`Unknown file type: ${ext}`);
  e.$metadata = { httpStatusCode: 400 };
  throw e;
}

function getUsers(context) {
  const profile = context.attributes?.authInfo?.profile;
  if (!profile) return [{ email: 'anonymous' }];
  const user = { email: profile.email };
  if (profile.user_id) user.user_id = profile.user_id;
  return [user];
}

export async function putSource({ context, info }) {
  const getResp = await getSource({ context, info, headOnly: true });
  const assignedId = context.data?.guid;
  if (assignedId && getResp.metadata?.id && getResp.metadata?.id !== assignedId) {
    return { body: `ID mismatch: ${assignedId} !== ${getResp.metadata?.id}`, status: 409, metadata: { id: assignedId } };
  }
  const ID = assignedId || getResp.metadata?.id || crypto.randomUUID();

  const storage = HelixStorage.fromContext(context);
  const bucket = storage.sourceBus();

  const body = context.data?.data;
  const {
    org, resourcePath: key, site, ext,
  } = info;
  const path = `${org}/${site}${key}`;
  try {
    const resp = await bucket.put(path, body, contentTypeFromExtension(ext), {
      id: ID,
      timestamp: `${Date.now()}`,
      users: JSON.stringify(getUsers(context)),
    });

    const status = resp.$metadata.httpStatusCode === 200 ? 201 : resp.$metadata.httpStatusCode;
    return { status, metadata: { id: ID } };
  } catch (e) {
    return { status: e.$metadata?.httpStatusCode || 500, metadata: { id: ID } };
  }
}
