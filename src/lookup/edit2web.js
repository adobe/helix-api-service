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
import google from './edit2web-google.js';
import onedrive from './edit2web-onedrive.js';
import { getSanitizedPath } from '../support/utils.js';

const HANDLERS = {
  google,
  onedrive,
};

/**
 * Performs a lookup from an edit url to a web resource.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {string} editUrl edit URL
 * @returns {Promise<LookupResponse|ErrorResponse>} the response
 */
export default async function edit2web(context, info, editUrl) {
  const { log, attributes: { config } } = context;
  const { contentBusId, source } = config.content;

  // validate edit url
  try {
    // eslint-disable-next-line no-new
    new URL(editUrl);
  } catch (e) {
    return {
      status: 400,
      error: `Unable to parse edit url: ${e.message}`,
    };
  }

  const handler = HANDLERS[source.type];
  if (!handler) {
    return {
      status: 404,
      error: `No handler found for document ${editUrl}.`,
    };
  }

  try {
    const result = await handler.lookup(context, info, {
      editUrl, contentBusId, source,
    });
    if (result.resourcePath.indexOf('..') >= 0) {
      log.warn(`Illegal characters in document path: ${result.resourcePath}`);
      return {
        status: 404,
        error: 'Illegal characters in document path',
      };
    }

    // sanitize path and check for illegal characters
    const { path, illegalPath } = getSanitizedPath(
      result.resourcePath,
      result.editContentType === 'application/folder',
    );
    if (illegalPath) {
      if (result.editContentType === 'application/folder') {
        result.illegalPath = result.resourcePath;
      } else {
        // assemble path via parent path
        const idx = result.resourcePath.lastIndexOf('/');
        result.illegalPath = result.resourcePath.substring(0, idx + 1) + result.editName;
      }
    }
    // update resource path
    result.resourcePath = path;

    // create webpath
    if (path.endsWith('/index.md')) {
      result.path = path.substring(0, path.length - '/index.md'.length + 1);
    } else if (path.endsWith('.md')) {
      result.path = path.substring(0, path.length - 3);
    } else {
      result.path = path;
    }

    return result;
  } catch (e) {
    log.warn(`Handler ${handler.name} threw an error:`, e);
    const code = e.statusCode || e.code;
    if (code === 429) {
      return {
        status: 503,
        severity: 'warn',
        error: `Handler ${handler.name} could not lookup ${editUrl}: (429) ${e.message}`,
      };
    }
  }

  return {
    status: 404,
    error: `Handler ${handler.name} could not lookup ${editUrl}.`,
  };
}
