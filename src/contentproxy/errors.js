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
const errors = [
  {
    code: 'AEM_BACKEND_FETCH_FAILED',
    template: 'Unable to fetch \'$1\' from \'$2\': $3',
  },
  {
    code: 'AEM_BACKEND_NOT_FOUND',
    template: 'Unable to preview \'$1\': File not found',
  },
  {
    code: 'AEM_BACKEND_TYPE_UNSUPPORTED',
    template: 'Unable to preview \'$1\': File type not supported: $2',
  },
  {
    code: 'AEM_BACKEND_NO_HANDLER',
    template: 'Unable to preview \'$1\': No handler found for document: $2',
  },
  {
    code: 'AEM_BACKEND_NON_MATCHING_MEDIA',
    template: 'Unable to preview \'$1\': content is not a \'$2\' but: $3',
  },
  {
    code: 'AEM_BACKEND_VALIDATION_FAILED',
    template: 'Unable to preview \'$1\': validation failed: $2',
  },
  {
    code: 'AEM_BACKEND_DOC_IMAGE_TOO_BIG',
    template: 'Unable to preview \'$1\': source contains large image: $2',
  },
  {
    code: 'AEM_BACKEND_UNSUPPORTED_MEDIA',
    template: 'Unable to preview \'$1\': \'$2\' backend does not support file type.',
  },
  {
    code: 'AEM_BACKEND_NO_CONTENT_TYPE',
    template: 'Unable to preview \'$1\': Content type header is missing',
  },
  {
    code: 'AEM_BACKEND_JSON_INVALID',
    template: 'Unable to preview \'$1\': JSON fetched from markup is invalid: $2',
  },
  {
    code: 'AEM_BACKEND_FILE_EMPTY',
    template: 'Unable to preview \'$1\': File is empty, no markdown version available',
  },
  {
    code: 'AEM_BACKEND_FILE_TOO_BIG',
    template: 'Unable to preview \'$1\': Documents larger than 100mb not supported: $2',
  },
  {
    code: 'AEM_BACKEND_RESOURCE_TOO_BIG',
    template: 'Files larger than 500mb are not supported: $1',
  },

  // mp4 media upload
  {
    code: 'AEM_BACKEND_MP4_PARSING_FAILED',
    template: 'Unable to preview \'$1\': Unable to parse MP4',
  },
  {
    code: 'AEM_BACKEND_MP4_TOO_LONG',
    template: 'Unable to preview \'$1\': MP4 is longer than 2 minutes: $2',
  },
  {
    code: 'AEM_BACKEND_MP4_BIT_RATE_TOO_HIGH',
    template: 'Unable to preview \'$1\': MP4 has a higher bitrate than 300 KB/s: $2',
  },
  // ico
  {
    code: 'AEM_BACKEND_ICO_TOO_BIG',
    template: 'Unable to preview \'$1\': ICO is larger than $2: $3',
  },
  // pdf
  {
    code: 'AEM_BACKEND_PDF_TOO_BIG',
    template: 'Unable to preview \'$1\': PDF is larger than $2: $3',
  },
  // svg validation
  {
    code: 'AEM_BACKEND_SVG_SCRIPTING_DETECTED',
    template: 'Unable to preview \'$1\': Script or event handler detected in SVG at: $2',
  },
  {
    code: 'AEM_BACKEND_SVG_ROOT_ITEM_MISSING',
    template: 'Unable to preview \'$1\': Expected XML content with an SVG root item',
  },
  {
    code: 'AEM_BACKEND_SVG_PARSING_FAILED',
    template: 'Unable to preview \'$1\': Unable to parse SVG XML',
  },
  {
    code: 'AEM_BACKEND_SVG_TOO_BIG',
    template: 'Unable to preview \'$1\': SVG is larger than $2: $3',
  },
  // img validation
  {
    code: 'AEM_BACKEND_IMAGE_TOO_BIG',
    template: 'Unable to preview \'$1\': Image is larger than $2: $3',
  },

  // config errors
  {
    code: 'AEM_BACKEND_CONFIG_EXISTS',
    template: 'Config already exists',
  },
  {
    code: 'AEM_BACKEND_CONFIG_TYPE_MISSING',
    template: 'No \'$1\' config in body or bad content type',
  },
  {
    code: 'AEM_BACKEND_CONFIG_TYPE_INVALID',
    template: 'Bad \'$1\' config: $2',
  },
  {
    code: 'AEM_BACKEND_CONFIG_MISSING',
    template: 'Config not found',
  },
  {
    code: 'AEM_BACKEND_CONFIG_READ',
    template: 'Error reading config: $1',
  },
  {
    code: 'AEM_BACKEND_CONFIG_CREATE',
    template: 'Error creating config: $1',
  },
  {
    code: 'AEM_BACKEND_CONFIG_UPDATE',
    template: 'Error updating config: $1',
  },
  {
    code: 'AEM_BACKEND_CONFIG_DELETE',
    template: 'Error removing config: $1',
  },
];

/**
 * @typedef ErrorInfo
 * @property {string} message
 * @property {string} [code]
 *
 *
 * Creates an `ErrorInfo` based on the given template and arguments.
 *
 * @param {string} template
 * @param {string[]} args
 * @returns {ErrorInfo}
 */
export function error(template, ...args) {
  const message = args.reduce((p, arg, i) => p.replace(`$${i + 1}`, arg), template);

  const err = errors?.find((e) => e.template === template);
  if (err) {
    return {
      message,
      code: err.code,
    };
  }
  return { message };
}
