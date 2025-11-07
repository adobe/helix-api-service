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
import { MediaHandler } from '@adobe/helix-mediahandler';

/**
 * Store media as a blob in the media bus.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {Buffer} buffer buffer
 * @param {string} contentType content type
 * @return {Promise<import('@adobe/fetch').Response>} response
 */
export async function storeBlob(context, info, buffer, contentType) {
  const { attributes, contentBusId, log } = context;
  const { org, site } = info;

  const {
    CLOUDFLARE_ACCOUNT_ID: r2AccountId,
    CLOUDFLARE_R2_ACCESS_KEY_ID: r2AccessKeyId,
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: r2SecretAccessKey,
  } = context.env;

  const mh = new MediaHandler({
    r2AccountId,
    r2AccessKeyId,
    r2SecretAccessKey,
    bucketId: attributes.bucketMap.media,
    owner: org,
    repo: site,
    ref: 'main',
    contentBusId,
    log,
  });

  // upload to media bus
  const blob = mh.createMediaResource(buffer, null, contentType);
  await mh.put(blob);
  return blob;
}
