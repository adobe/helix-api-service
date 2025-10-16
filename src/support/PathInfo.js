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
import { sanitizeName } from '@adobe/helix-shared-string';

/**
 * Split a filename into basename and extension.
 *
 * @param {string} filename filename
 * @returns {object} containing `basename` and `extension`
 */
function splitExtension(filename) {
  const idx = filename.lastIndexOf('.');
  if (idx > 0) {
    return {
      basename: sanitizeName(filename.substring(0, idx)),
      ext: filename.substring(idx),
    };
  }
  return {
    basename: sanitizeName(filename),
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

  const { basename, ext } = splitExtension(filename);
  if (!basename || basename === 'index') {
    // last segment empty or index
    return {
      webPath: combine(segs, ''),
      resourcePath: combine(segs, 'index.md'),
      ext: '.md',
    };
  } else if (!ext || ext === '.html' || ext === '.md') {
    // if last segment has no extension or is .html or .md, use `.md`
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

export class PathInfo {
  constructor(org) {
    this.org = org;
  }

  /**
   * Create a new path info.
   *
   * @param {object} param0 params
   * @param {string} param0.org org
   * @param {string} [param0.site] site, optional
   * @param {string} [param0.path] path, optional
   * @returns {PathInfo}
   */
  static create({ org, site, path }) {
    const info = new PathInfo(org);
    if (org) {
      info.org = org;
    }
    if (site) {
      info.site = site;
    }
    if (path) {
      const { webPath, resourcePath, ext } = computePaths(path);
      if (ext === '.aspx') {
        // onedrive doesn't like .aspx extension and reports wit 500. so we just reject it.
        return null;
      }
      Object.assign(info, { webPath, resourcePath, ext });
    }
    return info;
  }
}
