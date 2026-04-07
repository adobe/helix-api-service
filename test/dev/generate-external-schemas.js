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
import fs from 'fs/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { SCHEMAS as STORAGE_SCHEMAS } from '@adobe/helix-config-storage';

const ALL_SCHEMAS = [
  {
    schemas: STORAGE_SCHEMAS,
    urlPrefix: 'https://ns.adobe.com/helix/config/',
    pathPrefix: '/helix/config/',
  },
];

// eslint-disable-next-line no-underscore-dangle
const __rootdir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

function rewriteRef(ref, { urlPrefix, pathPrefix }) {
  if (ref.startsWith(urlPrefix)) {
    const { pathname, hash } = new URL(ref);
    const name = pathname.substring(pathPrefix.length).replaceAll('/', '-');
    return `${name}.json${hash}`;
  }
  return '';
}

/* eslint-disable no-param-reassign */
function rewrite(obj, category) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (key === '$ref') {
      obj.$ref = rewriteRef(value, category) || value;
    } else if (key === 'errorMessage') {
      delete obj[key];
    } else if (key === 'examples' && obj.type === 'array' && Array.isArray(value)) {
      // remove examples that are individual items instead of arrays (causes redocly warnings)
      delete obj[key];
    } else if (typeof value === 'object') {
      rewrite(value, category);
    }
  }
}
/* eslint-enable no-param-reassign */

async function run() {
  const dir = resolve(__rootdir, 'docs/openapi/schemas/config');
  for (const category of ALL_SCHEMAS) {
    for (const schema of category.schemas) {
      delete schema['meta:license'];
      rewrite(schema, category);
      const name = rewriteRef(schema.$id, category);
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(`${dir}/${name}`, JSON.stringify(schema, null, 2));
    }
  }
}

// eslint-disable-next-line no-console
run().catch(console.error);
