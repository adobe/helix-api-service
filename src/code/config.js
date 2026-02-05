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
import { MountConfig } from '@adobe/helix-shared-config';

/**
 * Config class for head.html
 */
class HeadLoader {
  constructor() {
    this._cfg = {};
    this._log = console;
  }

  withLogger(log) {
    this._log = log;
    return this;
  }

  withSource(src) {
    this._cfg = {
      html: src,
    };
    return this;
  }

  // eslint-disable-next-line class-methods-use-this
  async init() {
    return this;
  }

  toJSON() {
    return this._cfg;
  }
}

/**
 * Configuration files information used to load and generate the aggregate.
 */
export const CONFIG_FILES = {
  'fstab.yaml': {
    name: 'fstab',
    Loader: MountConfig,
  },
  'head.html': {
    name: 'head',
    Loader: HeadLoader,
  },
};

/**
 * Path of the aggregate config
 * @type {string}
 */
export const CONFIG_PATH = 'helix-config.json';

/**
 * Validates the config
 * @param {Logger} log
 * @param {string} key storage key. for example 'fstab.yaml'
 * @param {Buffer} data
 * @return {Promise<boolean>} true if valid
 */
export async function validate(log, key, data) {
  const { name, Loader } = CONFIG_FILES[key] || {};
  if (!name) {
    return true;
  }
  try {
    await new Loader()
      .withLogger(log)
      .withSource(data.toString('utf-8'))
      .init();
    return true;
  } catch (e) {
    log.info(`${name} config from ${key} not valid: ${e.message}`);
  }
  return false;
}

/**
 * Creates and aggregate of the configurations in the given changes object.
 *
 * @param {Logger} log
 * @param {Object<string, ProcessedChange>} configChanges
 * @param {object} previousConfig the previous config
 * @returns {Promise<{HelixConfig}>} the combined config
 */
export async function aggregate(log, configChanges, previousConfig) {
  const combined = {
    version: 2,
  };

  // for all config change objects
  let hasErrors = false;
  await Promise.all(Object.entries(configChanges)
    // filter the ones that don't have data (i.e. don't exist in github)
    .filter(([_, change]) => !!change.data)
    // create the config and add it to the aggregate
    .map(async ([path, change]) => {
      const { name, Loader } = CONFIG_FILES[path];
      try {
        const config = await new Loader()
          .withLogger(log)
          .withSource(change.data.toString('utf-8'))
          .init();

        combined[name] = {
          data: config.toJSON(),
        };
        if (change.lastModified) {
          combined[name].lastModified = change.lastModified;
        }
      } catch (e) {
        if (previousConfig[name]) {
          log.error(`Unable to create ${name} config from ${path}: ${e.message}`);
          hasErrors = true;
        } else {
          log.warn(`Unable to create ${name} config from ${path}: ${e.message} (ignored)`);
        }
      }
    }));

  if (hasErrors) {
    throw new Error('Errors while aggregating configurations.');
  }
  return combined;
}
