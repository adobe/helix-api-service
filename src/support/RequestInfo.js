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
/* eslint-disable max-classes-per-file */

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
export function splitExtension(filename, sanitize) {
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
  // special case: '.index.html'
  if (filename === 'index.html') {
    return {
      webPath: path,
      resourcePath: path,
      ext: '.html',
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

/**
 * Class containing the aspects of the HTTP request.
 */
class HttpRequest {
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
}

/**
 * Class containing the aspects of the decomposed path.
 */
class PathInfo {
  constructor(route, org, site, path) {
    this.route = route;
    this.org = org;
    this.site = site;
    this.path = path;

    if (path) {
      const { webPath, resourcePath, ext } = computePaths(path);
      if (ext === '.aspx') {
        // onedrive doesn't like .aspx extension and reports wit 500. so we just reject it.
        throw new StatusCodeError('', 404);
      }
      Object.assign(this, {
        rawPath: path, webPath, resourcePath, ext,
      });
    }
  }

  /**
   * Clone another path info.
   *
   * @param {PathInfo} other other info
   * @param {object} param0 params
   * @param {string} [param0.org] org, optional
   * @param {string} [param0.site] site, optional
   * @param {string} [param0.path] path, optional
]  * @param {string} [param0.route] route, optional
   * @returns {PathInfo} clone with the params overwritten
   */
  static clone(other, {
    route, org, site, path,
  }) {
    return new PathInfo(
      route ?? other.route,
      org ?? other.org,
      site ?? other.site,
      path ?? other.path,
    );
  }
}

/**
 * Class containing the aspects of both HTTP request and decomposed path.
 */
export class RequestInfo {
  #request;

  #router;

  #pathInfo;

  #owner;

  #repo;

  #ref;

  constructor(request, router, pathInfo) {
    this.#request = request;
    this.#router = router;
    this.#pathInfo = pathInfo;
  }

  // eslint-disable-next-line class-methods-use-this
  get path() {
    throw new Error();
  }

  withCode(owner, repo) {
    this.#owner = owner;
    this.#repo = repo;

    return this;
  }

  withRef(ref) {
    this.#ref = ref;

    return this;
  }

  get method() {
    return this.#request.method;
  }

  get headers() {
    return this.#request.headers;
  }

  get buffer() {
    return this.#request.buffer;
  }

  get cookies() {
    return this.#request.cookies;
  }

  get scheme() {
    return this.#request.scheme;
  }

  get host() {
    return this.#request.host;
  }

  get query() {
    return this.#request.query;
  }

  get owner() {
    return this.#owner;
  }

  get repo() {
    return this.#repo;
  }

  get ref() {
    return this.#ref ?? 'main';
  }

  get route() {
    return this.#pathInfo.route;
  }

  get org() {
    return this.#pathInfo.org;
  }

  get site() {
    return this.#pathInfo.site;
  }

  get rawPath() {
    return this.#pathInfo.rawPath;
  }

  get webPath() {
    return this.#pathInfo.webPath;
  }

  get resourcePath() {
    return this.#pathInfo.resourcePath;
  }

  get ext() {
    return this.#pathInfo.ext;
  }

  /**
   * Create a new request info.
   *
   * @param {import('@adobe/fetch').Request} request request
   * @param {import('../router/router.js').default} router router
   * @param {object} param0 params
   * @param {string} [param0.org] org, optional
   * @param {string} [param0.site] site, optional
   * @param {string} [param0.path] path, optional
   * @param {string} [param0.ref] ref, optional
   * @param {string} [param0.route] route, optional
   * @returns {RequestInfo}
   */
  static create(request, router, {
    org, site, path, ref, route,
  } = {}) {
    const httpRequest = new HttpRequest(request);
    const pathInfo = new PathInfo(route, org, site, path);

    return Object.freeze(new RequestInfo(httpRequest, router, pathInfo).withRef(ref));
  }

  /**
   * Clone an existing request info.
   *
   * @param {RequestInfo} other
   * @param {object} param0 params
   * @param {string} [param0.org] org
   * @param {string} [param0.site] site, optional
   * @param {string} [param0.path] path, optional
   * @param {string} [param0.route] route
   * @returns {RequestInfo}
   */
  static clone(other, {
    org, site, path, route,
  }) {
    const info = new RequestInfo(
      other.#request,
      other.#router,
      PathInfo.clone(other.#pathInfo, {
        org, site, path, route,
      }),
    );
    info.#owner = other.#owner;
    info.#repo = other.#repo;
    info.#ref = other.#ref;

    return Object.freeze(info);
  }

  getPreviewUrl() {
    return `https://${this.ref}--${this.site}--${this.org}.aem.page${this.webPath}`;
  }

  getLiveUrl() {
    return `https://${this.ref}--${this.site}--${this.org}.aem.live${this.webPath}`;
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

  getAPIUrls(...routes) {
    const links = {};
    const variables = {
      org: this.org,
      site: this.site,
      path: this.webPath.slice(1),
      ref: this.ref,
    };
    routes.forEach((name) => {
      const path = this.#router.external(name, variables);
      links[name] = this.getLinkUrl(path);
    });
    return links;
  }

  toResourcePath() {
    return toResourcePath(this.webPath);
  }
}
