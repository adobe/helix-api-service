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
import { MountConfig } from '@adobe/helix-shared-config';
import google from './web2edit-google.js';
// import onedrive from './web2edit-onedrive.js';
// import github from './web2edit-github.js';
import markup from './web2edit-markup.js';

const HANDLERS = [
  google,
  // onedrive,
  // github,
  markup,
];

/**
 * Performs a lookup from the web resource to the source document (e.g. word document).
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} param
 * @param {MountPoint} param.source mount point
 * @param {string} param.contentBusId contentBusId
 * @returns {Promise<LookupResponse|ErrorResponse>} the lookup response
 */
export async function lookup(context, info, { contentBusId, source }) {
  const { log } = context;
  const { org, site, webPath } = info;

  const uri = `hlx:/${org}/${site}${webPath}`;
  const handler = HANDLERS.find(({ test }) => test && test(source));
  if (!handler) {
    return {
      status: 404,
      error: `No handler found for document ${uri}.`,
    };
  }

  try {
    return await handler.lookup(context, info, { contentBusId, source });
  } catch (e) {
    const result = {
      status: e.statusCode || e.status,
      error: `Handler ${handler.name} could not lookup ${uri}.`,
    };
    if (result.status === 404) {
      log.info(`Handler reported: ${e.message}:`);
    } else {
      log.warn(`Handler ${handler.name} threw an error:`, e);
      if (e.rateLimit) {
        result.severity = 'warn';
      }
    }
    return result;
  }
}

/**
 * Performs a lookup from the web resource to the source document (e.g. word document).
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<LookupResponse|ErrorResponse>} the lookup response
 */
export default async function web2edit(context, info) {
  const { attributes: { config } } = context;

  const { contentBusId, source: base, overlay } = config.content;

  // TODO: fstab no longer required
  const fstab = await new MountConfig().withJSON({
    mountpoints: {
      '/': base,
    },
  }).init();

  const sources = [fstab.match(info.resourcePath)];
  if (overlay) {
    sources.unshift(overlay);
  }

  const results = [];

  for (const source of sources) {
    // eslint-disable-next-line no-await-in-loop
    const result = await lookup(context, info, {
      contentBusId,
      source,
    });
    if (result.status === 200) {
      return result;
    }
    results.push(result);
  }
  // return overlay result, even if it failed.
  return results[0];
}
