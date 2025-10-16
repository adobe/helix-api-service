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

function combinePath(segs, filename) {
  return `/${[...segs, filename].join('/')}`;
}

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
      webPath: combinePath(segs, `${basename}.plain.html`),
      resourcePath: combinePath(segs, `${basename}.md`),
      ext: '.md',
    };
  }

  const idx = filename.lastIndexOf('.');
  if (idx === 0) {
    // code-bus resource starting with '.', eg: .hlxignore
    return {
      webPath: combinePath(segs, filename),
      resourcePath: combinePath(segs, filename),
      ext: '',
    };
  }

  const { basename, ext } = splitExtension(filename);
  if (!basename || basename === 'index') {
    // last segment empty or index
    return {
      webPath: combinePath(segs, ''),
      resourcePath: combinePath(segs, 'index.md'),
      ext: '.md',
    };
  } else if (!ext || ext === '.html' || ext === '.md') {
    // if last segment has no extension or is .html or .md, use `.md`
    return {
      webPath: combinePath(segs, basename),
      resourcePath: combinePath(segs, `${basename}.md`),
      ext: '.md',
    };
  }
  return {
    webPath: combinePath(segs, `${basename}${ext}`),
    resourcePath: combinePath(segs, `${basename}${ext}`),
    ext,
  };
}

export class PathInfo {
  constructor(org) {
    this.org = org;
  }

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
