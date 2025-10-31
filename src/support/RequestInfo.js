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
import { parse } from 'cookie';
import { sanitizeName } from '@adobe/helix-shared-string';
import { StatusCodeError } from './StatusCodeError.js';

/**
 * Split a filename into basename and extension.
 *
 * @param {string} filename filename
 * @param {boolean} [sanitize] whether to sanitize basename
 * @returns {object} containing `basename` and `extension`
 */
function splitExtension(filename, sanitize) {
  const transform = sanitize ? sanitizeName : (s) => s;

  const idx = filename.lastIndexOf('.');
  if (idx > 0) {
    return {
      basename: transform(filename.substring(0, idx)),
      ext: filename.substring(idx),
    };
  }
  return {
    basename: transform(filename),
    ext: '',
  };
}

/**
 * Combine directory name and filename.
 *
 * @param {string[]} segs directory name as segments
 * @param {string} filename filename
 * @returns {string} combined path
 */
function combine(segs, filename) {
  return `/${[...segs, filename].join('/')}`;
}

/**
 * Compute resource path from a web path.
 *
 * @param {string} path path
 * @returns {string} resource path
 */
export function toResourcePath(path) {
  if (!path.startsWith('https://') && !path.startsWith('/')) {
    return '';
  }

  const { pathname } = new URL(path, 'https://api.aem.live');
  const segs = pathname.split('/').slice(1);
  const filename = segs.pop();

  const { basename, ext } = splitExtension(filename);
  if (!basename) {
    // last segment empty
    return combine(segs, 'index.md');
  }
  if (!ext) {
    return combine(segs, `${basename}.md`);
  }
  if (basename.endsWith('.plain')) {
    return combine(segs, `${basename.substring(0, basename.length - 6)}.md`);
  }
  return combine(segs, `${basename}${ext}`);
}

/**
 * Compute web path, resource path and extension.
 *
 * @param {string} path path
 * @returns {object} containing `webPath`, `resourcePath` and `extension
 */
export function computePaths(path) {
  const segs = path.split('/').slice(1);
  const filename = segs.pop();

  // special case: '*'
  if (filename === '*') {
    return {
      webPath: '/*', resourcePath: '/*', ext: '',
    };
  }
  // special case: '.plain.html'
  if (filename.endsWith('.plain.html')) {
    const basename = sanitizeName(filename.substring(0, filename.length - '.plain.html'.length));
    return {
      webPath: combine(segs, `${basename}.plain.html`),
      resourcePath: combine(segs, `${basename}.md`),
      ext: '.md',
    };
  }

  const idx = filename.lastIndexOf('.');
  if (idx === 0) {
    // code-bus resource starting with '.', eg: .hlxignore
    return {
      webPath: combine(segs, filename),
      resourcePath: combine(segs, filename),
      ext: '',
    };
  }

  const { basename, ext } = splitExtension(filename, true);
  if (!basename || basename === 'index') {
    // last segment empty or index
    return {
      webPath: combine(segs, ''),
      resourcePath: combine(segs, 'index.md'),
      ext: '.md',
    };
  }
  if (!ext || ext === '.md') {
    // if last segment has no extension or is .md, use `.md`
    return {
      webPath: combine(segs, basename),
      resourcePath: combine(segs, `${basename}.md`),
      ext: '.md',
    };
  }
  return {
    webPath: combine(segs, `${basename}${ext}`),
    resourcePath: combine(segs, `${basename}${ext}`),
    ext,
  };
}

export class RequestInfo {
  /**
   * @constructs RequestInfo
   * @param {import('@adobe/fetch').Request} request request
   */
  constructor(request) {
    this.method = request.method.toUpperCase();
    this.headers = request.headers.plain();
    this.buffer = () => request.buffer();

    const { cookie } = this.headers;
    this.cookies = cookie ? structuredClone(parse(cookie)) : {};

    this.scheme = process.env.HLX_DEV_SERVER_SCHEME ?? 'https';
    this.host = process.env.HLX_DEV_SERVER_HOST ?? 'api.aem.live';
    this.query = {};
  }

  /**
   * Create a new request info.
   *
   * @param {import('@adobe/fetch').Request} request request
   * @param {object} param0 params
   * @param {string} [param0.org] org
   * @param {string} [param0.site] site, optional
   * @param {string} [param0.path] path, optional
   * @param {string} [param0.route] route
   * @returns {RequestInfo}
   */
  static create(request, {
    org, site, path, route,
  } = {}) {
    const info = new RequestInfo(request);

    info.route = route;
    info.org = org;
    info.site = site;

    if (path) {
      const { webPath, resourcePath, ext } = computePaths(path);
      if (ext === '.aspx') {
        // onedrive doesn't like .aspx extension and reports wit 500. so we just reject it.
        throw new StatusCodeError('', 404);
      }
      Object.assign(info, {
        rawPath: path, webPath, resourcePath, ext,
      });
    }
    // return Object.freeze(info);
    return info;
  }

  getPreviewUrl() {
    return `https://main--${this.site}--${this.org}.aem.page${this.webPath}`;
  }

  getLiveUrl() {
    return `https://main--${this.site}--${this.org}.aem.live${this.webPath}`;
  }

  getLinkUrl(path, query) {
    const url = new URL(`${this.scheme ?? 'https'}://${this.host}${path}`);
    Object.entries(this.query).forEach(([name, value]) => {
      url.searchParams.append(name, value);
    });
    if (query) {
      Object.entries(query).forEach(([name, value]) => {
        url.searchParams.append(name, value);
      });
    }
    return url.href;
  }
}
