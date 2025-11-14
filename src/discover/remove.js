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
import { Response } from '@adobe/fetch';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { Inventory } from './inventory.js';

/**
 * Remove a project.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {string} org owner
 * @param {string} site repo
 * @returns {Promise<Response>} response
 */
export async function removeProject(context, org, site) {
  const { log } = context;
  const contentBus = HelixStorage.fromContext(context).contentBus();

  const inventory = new Inventory(contentBus, log);
  await inventory.load();

  if (inventory.removeEntry(org, site)) {
    await inventory.save();
    return new Response('', { status: 204 });
  }
  return new Response('', { status: 404 });
}

/**
 * Remove a project.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @returns {Promise<Response>} response
 */
export default async function remove(context) {
  const { data: { org, site } } = context;
  if (org && site) {
    return removeProject(context, org, site);
  }
  return new Response('', {
    status: 400,
    headers: {
      'x-error': 'remove requires `org` and `site`',
    },
  });
}
