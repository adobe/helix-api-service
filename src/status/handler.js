/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { Response } from '@adobe/fetch';
import { loadSiteConfig } from '../config/utils.js';

export default async function handler(request, context, variables) {
  const { log } = context;
  const { org, site, path } = variables;

  const config = await loadSiteConfig(context, org, site);
  if (config === null) {
    return new Response('', { status: 404 });
  }

  log.info(`handler called, with org/site: ${org}/${site}, and path: ${path}`);
  return new Response('', { status: 405 });
}
