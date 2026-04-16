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
import { ConfigStore, ValidationError } from '@adobe/helix-config-storage';
import { HelixStorage } from '@adobe/helix-shared-storage';
import purge from '../cache/purge.js';
import { error } from '../contentproxy/errors.js';
import discover from '../discover/on-change.js';
import sitemap from '../sitemap/config-update.js';
import sourceLock from '../support/source-lock.js';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { errorResponse, redactObject, resolveAllowList } from '../support/utils.js';

/**
 * List of properties that are allowed to be included in the redacted config output.
 * This is used by the redactObject function when a config is retrieved with
 * permission "config:read-redacted".
 */
const REDACT_ALLOW_LISTS = {
  org: [
    'title',
    'description',
    'version',
  ],
  sites: [
    'cdn/prod/host',
    'cdn/prod/type',
    'code',
    'content',
    'extends',
    'headers',
    'version',
  ],
  profiles: [
    'cdn/prod/host',
    'cdn/prod/type',
    'code',
    'content',
    'headers',
    'version',
  ],
};

function diff(o0, o1, prop) {
  return JSON.stringify(o0?.[prop]) !== JSON.stringify(o1?.[prop]);
}

/**
 * Extends the config store by adding fetch methods and implementing the purge method.
 */
export class AdminConfigStore extends ConfigStore {
  /**
   * Serializes an object to JSON. If the store is redacted,
   * the object is redacted before serialization.
   * @private
   * @param {object} obj - The object to serialize.
   * @param {string} relPath - The relative path within the object.
   * @returns {string} The serialized object.
   */
  #serialize(obj, relPath) {
    let result = obj;

    if (this.redacted) {
      const allowList = resolveAllowList(this.type, relPath, REDACT_ALLOW_LISTS);
      result = redactObject(obj, allowList);
    }

    return JSON.stringify(result, null, 2);
  }

  async validate(context, data) {
    await super.validate(context, data);
    if (this.type === 'sites' || this.type === 'profiles') {
      const sourceUrl = data.content?.source?.url;
      if (sourceUrl) {
        const { org, name: site } = this;
        const {
          allowed,
          reason,
        } = await sourceLock.evaluateUrl(context, org, site, new URL(sourceUrl));
        if (!allowed) {
          throw new StatusCodeError(reason, 400);
        }
      }
    }
  }

  /**
   * Sets whether the store is redacted.
   * @param {boolean} redacted - Whether the store is redacted.
   * @returns {AdminConfigStore} This store.
   */
  setRedacted(redacted) {
    this.redacted = redacted;
    return this;
  }

  /**
   * Reads a config object from the store
   *
   * @param {import('../support/AdminContext').AdminContext} context admin context
   * @param {string} relPath relative path to the config object
   * @returns {Promise<Response>}
   */
  async fetchRead(context, relPath) {
    try {
      if (String(context.data?.details) === 'true' && (this.type === 'sites' || this.type === 'profiles')) {
        this.withListDetails(({ content, code, cdn }) => {
          const ret = {
            content,
            code,
          };
          if (cdn?.prod?.host) {
            ret.cdn = {
              prod: {
                host: cdn.prod.host,
              },
            };
          }
          return ret;
        });
      }
      const obj = await this.read(context, relPath);
      if (!obj) {
        return new Response(null, { status: 404 });
      }
      return new Response(this.#serialize(obj, relPath), {
        headers: {
          'content-type': 'application/json',
        },
      });
    } catch (e) {
      /* c8 ignore next */
      return errorResponse(context.log, e.statusCode || 500, error('Error reading config: $1', e.message));
    }
  }

  /**
   * Creates a config object in the store
   *
   * @param {import('../support/AdminContext').AdminContext} context admin context
   * @param {string} relPath relative path to the config object
   * @returns {Promise<Response>}
   */
  async fetchCreate(context, relPath) {
    try {
      await this.create(context, context.data, relPath);
      return new Response(null, { status: 201 });
    } catch (e) {
      if (e instanceof ValidationError) {
        e.statusCode = 400;
      }
      /* c8 ignore next */
      return errorResponse(context.log, e.statusCode || 400, error('Error creating config: $1', e.message));
    }
  }

  /**
   * Updates a config object in the store
   *
   * @param {import('../support/AdminContext').AdminContext} context admin context
   * @param {string} relPath relative path to the config object
   * @returns {Promise<Response>}
   */
  async fetchUpdate(context, relPath) {
    try {
      const { jwt } = context.data;
      const obj = await this.update(context, context.data, relPath);
      // this might not be the best place, but include the apiKey jwt in the response as `value`
      // if it was passed as input (when generated in the handler)
      if (jwt && relPath === 'apiKeys') {
        obj.value = jwt;
      }
      return new Response(this.#serialize(obj, relPath), {
        headers: {
          'content-type': 'application/json',
        },
      });
    } catch (e) {
      /* c8 ignore next */
      return errorResponse(context.log, e.statusCode || 400, error('Error updating config: $1', e.message));
    }
  }

  /**
   * Removes a config object from the store
   *
   * @param {import('../support/AdminContext').AdminContext} context admin context
   * @param {string} relPath relative path to the config object
   * @returns {Promise<Response>}
   */
  async fetchRemove(context, relPath) {
    try {
      await this.remove(context, relPath);
      return new Response(null, { status: 204 });
    } catch (e) {
      /* c8 ignore next */
      return errorResponse(context.log, e.statusCode || 500, error('Error removing config: $1', e.message));
    }
  }

  /**
   * Purges the cache based on the old and new config (internal implementation).
   *
   * @param {import('../support/AdminContext').AdminContext} context admin context
   * @param {object} oldConfig old config object
   * @param {object} newConfig new config object
   * @returns {Promise<void>}
   */
  async #doPurge(context, oldConfig, newConfig) {
    const opts = {
      org: this.org,
      site: this.name,
      keys: [],
    };
    const changed = {};

    if (oldConfig === null && newConfig !== null) {
      // new config created, purge new code and content
      const newKey = `main--${newConfig.code.repo}--${newConfig.code.owner}_code`;
      context.log.info(`config created. purging code of ${newKey} and content of ${newConfig.content.contentBusId}`);
      opts.keys.push(newKey);
      if (newConfig.content.contentBusId) {
        opts.keys.push(newConfig.content.contentBusId);
        opts.keys.push(`p_${newConfig.content.contentBusId}`);
      }
    } else if (oldConfig != null && newConfig === null) {
      // config removed, purge old code and content
      const oldKey = `main--${oldConfig.code.repo}--${oldConfig.code.owner}_code`;
      context.log.info(`config removed. purging code of ${oldKey} and content of ${oldConfig.content.contentBusId}`);
      opts.keys.push(oldKey);
      if (oldConfig.content.contentBusId) {
        opts.keys.push(oldConfig.content.contentBusId);
        opts.keys.push(`p_${oldConfig.content.contentBusId}`);
      }
      opts.owner = oldConfig.code.owner;
      opts.repo = oldConfig.code.repo;
    } else if (oldConfig != null && newConfig != null) {
      // if code source changed, purge the old code
      let purgeCode = false;
      const oldKey = `main--${oldConfig.code.repo}--${oldConfig.code.owner}_code`;
      const newKey = `main--${newConfig.code.repo}--${newConfig.code.owner}_code`;
      if (oldKey !== newKey) {
        opts.keys.push(oldKey);
        purgeCode = true;
      }

      // if content changed, purge the old one
      let purgeContent = false;
      if (oldConfig.content.contentBusId !== newConfig.content.contentBusId) {
        if (oldConfig.content.contentBusId) {
          opts.keys.push(oldConfig.content.contentBusId);
          opts.keys.push(`p_${oldConfig.content.contentBusId}`);
        }
        purgeContent = true;
      }

      // if headers or access changed, purge content and code
      for (const prop of ['headers', 'access']) {
        if (diff(oldConfig, newConfig, prop)) {
          purgeCode = true;
          purgeContent = true;
          break;
        }
      }

      // if folders changed, purge content
      if (!purgeContent && diff(oldConfig, newConfig, 'folders')) {
        purgeContent = true;
      }

      // if prod host changed, purge content
      if (oldConfig?.cdn?.prod?.host !== newConfig?.cdn?.prod?.host) {
        changed.cdn = {
          prod: {
            host: {
              old: oldConfig?.cdn?.prod?.host,
              new: newConfig?.cdn?.prod?.host,
            },
          },
        };
        purgeContent = true;
      }

      if (purgeCode) {
        context.log.info(`config change affects code. purging code of ${newKey}`);
        opts.keys.push(newKey);
      }
      if (purgeContent) {
        context.log.info(`config change affects content. purging content of ${newConfig.content.contentBusId}`);
        if (newConfig.content.contentBusId) {
          opts.keys.push(newConfig.content.contentBusId);
          opts.keys.push(`p_${newConfig.content.contentBusId}`);
        }
      }
    }

    // apply the new config to the context
    if (newConfig) {
      // todo: properly handle new config aggregate
      const info = {
        owner: newConfig.code.owner,
        repo: newConfig.code.repo,
        org: this.org,
        site: this.name,
      };
      // TODO: just use new config
      // await applyConfig(ctx, info, newConfig);
      opts.owner = newConfig.code.owner;
      opts.repo = newConfig.code.repo;

      // ensure the info marker is set in the content bus for new projects
      if (!oldConfig) {
        const storage = HelixStorage.fromContext(context).contentBus();
        await context.ensureInfoMarker(
          info,
          storage,
          newConfig.content.source.url,
        );
      }
    }
    // note that in case of production cdn change, the old cdn is not purged. this is intentional,
    // so that the old cdn can still serve the old content while the new cdn is warming up.
    await purge.config(context, opts);

    if (changed.cdn) {
      const info = {
        org: this.org,
        site: this.name,
        owner: this.org,
        repo: this.name,
      };
      await sitemap.hostUpdated(context, info, changed.cdn.prod.host);
    }
  }

  /**
   * Purges the cache based on the old and new config.
   *
   * @override
   * @param {import('../support/AdminContext').AdminContext} context admin context
   * @param {object} oldConfig old config object
   * @param {object} newConfig new config object
   * @returns {Promise<void>}
   */
  async purge(context, oldConfig, newConfig) {
    if (this.type === 'org' || this.type === 'profiles') {
      // for org and profile changes, invalidate all site configs
      // todo: only purge sites that use the profile?
      await purge.config(context, {
        org: this.org,
        site: 'default',
        keys: [],
        purgeOrg: true,
      });
      return;
    }

    // first purge the config
    await this.#doPurge(context, oldConfig, newConfig);

    // inform discovery about project change
    await discover.projectChanged(context, oldConfig, newConfig, this.org, this.name);
  }
}
