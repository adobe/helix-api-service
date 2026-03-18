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
import { IndexConfig, SitemapConfig } from '@adobe/helix-shared-config';
import { HelixStorage } from '@adobe/helix-shared-storage';
import { errorResponse } from '../support/utils.js';
import { error } from '../contentproxy/errors.js';
import { checkPrimarySite } from './utils.js';

/**
 * Configuration types and their corresponding content type and extension.
 */
export const CONFIG_TYPES = {
  query: {
    contentType: 'text/yaml',
    extension: 'yaml',
    YAMLConfig: IndexConfig,
  },
  sitemap: {
    contentType: 'text/yaml',
    extension: 'yaml',
    YAMLConfig: SitemapConfig,
  },
};

/**
 * Content store for index, sitemap and crontab configurations that will store data
 * in the `helix-content-bus` bucket.
 */
export class ContentStore {
  /**
   * @constructor
   * @param {string} type config type (e.g. 'query', 'sitemap')
   * @param {string} contentBusId content bus ID
   */
  constructor(type, contentBusId) {
    this.type = type;
    this.config = CONFIG_TYPES[type];
    this.contentBusId = contentBusId;
    this.key = `${contentBusId}/preview/.helix/${type}.${this.config.extension}`;
  }

  /**
   * Read an object from the content bus.
   *
   * @param {import('../support/AdminContext').AdminContext} context
   * @param {import('../support/RequestInfo').RequestInfo} info
   * @returns {Promise<Response>}
   */
  async fetchRead(context) {
    const storage = HelixStorage.fromContext(context).contentBus();
    const buf = await storage.get(this.key);
    if (!buf) {
      return new Response('', { status: 404 });
    }
    return new Response(buf, {
      headers: {
        'content-type': this.config.contentType,
      },
    });
  }

  /**
   * Creates a config object in the content bus.
   *
   * @param {import('../support/AdminContext').AdminContext} context
   * @param {import('../support/RequestInfo').RequestInfo} info
   * @returns {Promise<Response>}
   */
  async fetchCreate(context, info) {
    const { log, data } = context;
    const { contentType, YAMLConfig } = this.config;

    const storage = HelixStorage.fromContext(context).contentBus();
    if (await storage.head(this.key)) {
      return errorResponse(log, 409, error('Config already exists'));
    }
    const primary = await checkPrimarySite(context, this.contentBusId, info);
    if (primary) {
      return errorResponse(log, 403, `Content configuration changes are restricted to the primary site: ${primary}`);
    }

    let body;

    try {
      if (typeof data !== 'string') {
        return errorResponse(log, 400, error('No \'$1\' config in body or bad content type', this.type));
      }
      const config = await new YAMLConfig().withSource(data.toString('utf-8')).init();
      const errors = config.getErrors();
      if (errors?.length) {
        const detail = errors.map(({ message }) => (message)).join('\n');
        return errorResponse(log, 400, error('Bad \'$1\' config: $2', this.type, detail));
      }
      body = config.toYAML();
    } catch (e) {
      log.warn(`Unable to process ${this.type} config: ${e.message}`);
      return errorResponse(log, 400, error('Bad \'$1\' config: $2', this.type, e.message));
    }
    await storage.put(this.key, body, contentType);
    return new Response('', { status: 201 });
  }

  /**
   * Updates a config object in the content bus.
   *
   * @param {import('../support/AdminContext').AdminContext} context
   * @param {import('../support/RequestInfo').RequestInfo} info
   * @returns {Promise<Response>}
   */
  async fetchUpdate(context, info) {
    const { log, data } = context;
    const { contentType, YAMLConfig } = this.config;

    const storage = HelixStorage.fromContext(context).contentBus();
    const primary = await checkPrimarySite(context, this.contentBusId, info);
    if (primary) {
      return errorResponse(log, 403, `Content configuration changes are restricted to the primary site: ${primary}`);
    }

    let body;

    try {
      if (typeof data !== 'string') {
        return errorResponse(log, 400, error('No \'$1\' config in body or bad content type', this.type));
      }
      const config = await new YAMLConfig().withSource(data.toString('utf-8')).init();
      const errors = config.getErrors();
      if (errors?.length) {
        const detail = errors.map(({ message }) => (message)).join('\n');
        return errorResponse(log, 400, error('Bad \'$1\' config: $2', this.type, detail));
      }
      body = config.toYAML();
    } catch (e) {
      log.warn(`Unable to process ${this.type} config: ${e.message}`);
      return errorResponse(log, 400, error('Bad \'$1\' config: $2', this.type, e.message));
    }
    await storage.put(this.key, body, contentType);
    return new Response('', { status: 204 });
  }

  /**
   * Removes a config object in the content bus.
   *
   * @param {import('../support/AdminContext').AdminContext} context
   * @param {import('../support/RequestInfo').RequestInfo} info
   * @returns {Promise<Response>}
   */
  async fetchRemove(context, info) {
    const { log } = context;

    const storage = HelixStorage.fromContext(context).contentBus();
    const primary = await checkPrimarySite(context, this.contentBusId, info);
    if (primary) {
      return errorResponse(log, 403, `Content configuration changes are restricted to the primary site: ${primary}`);
    }

    const buf = await storage.get(this.key);
    if (!buf) {
      return errorResponse(log, 404, error('Config not found'));
    }
    await storage.remove(this.key);
    return new Response('', { status: 204 });
  }
}
