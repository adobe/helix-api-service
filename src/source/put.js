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
import { HelixStorage } from '@adobe/helix-shared-storage';
import { getSource } from './get.js';
import { createErrorResponse } from '../contentbus/utils.js';

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
  if (!profile) {
    return [{ email: 'anonymous' }];
  }
  const user = { email: profile.email };
  if (profile.user_id) {
    user.user_id = profile.user_id;
  }
  return [user];
}

export async function putSource({ context, info }) {
  const { log } = context;

  const getResp = await getSource({ context, info, headOnly: true });
  const assignedID = context.data?.guid;
  const existingID = getResp.headers.get('x-da-id');
  if (assignedID && existingID && existingID !== assignedID) {
    return new Response(
      `ID mismatch: ${assignedID} !== ${existingID}`,
      { status: 409 },
    );
  }
  const ID = assignedID || existingID || crypto.randomUUID();

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
      users: JSON.stringify(getUsers(context)),
    });

    const status = resp.$metadata.httpStatusCode === 200 ? 201 : resp.$metadata.httpStatusCode;
    return new Response('', { status, headers: { 'x-da-id': ID } });
  } catch (e) {
    const opts = { e, log };
    opts.status = e?.$metadata?.httpStatusCode;
    return createErrorResponse(opts);
  }
}
