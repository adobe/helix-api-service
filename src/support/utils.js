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
import dns from 'node:dns';
import { promisify } from 'util';
import isIpPrivate from 'private-ip';

import { Response } from '@adobe/fetch';
import { sanitizeName } from '@adobe/helix-shared-string';
import { cleanupHeaderValue, logLevelForStatusCode, propagateStatusCode } from '@adobe/helix-shared-utils';
import { ModifiersConfig } from '@adobe/helix-shared-config';

/**
 * DNS lookup method.
 * @function
 * @return {Promise<void>}
 */
export const dnsLookup = promisify(dns.lookup);

/**
 * Check if resolved IP for a hostname is private.
 *
 * @param {string} hostname hostname to test
 * @param {import('@adobe/helix-universal').Logger} log logger
 * @returns true if the resolved IP is private, otherwise false
 */
export async function isInternal(hostname, log) {
  try {
    const { address } = await dnsLookup(hostname);
    return isIpPrivate(address);
    /* c8 ignore next 4 */
  } catch (e) {
    log.warn(`Unable to resolve hostname: ${hostname}: ${e.message}`);
    return true;
  }
}

/**
 * list of headers not allowed in the headers.json file.
 */
const IGNORED_META_OVERRIDES = [
  'x-commit-id',
  'x-source-last-modified',
  'content-security-policy',
  'content-security-policy-report-only',
  'connection',
  'keep-alive',
  'public',
  'proxy-authenticate',
  'content-encoding',
  'transfer-encoding',
  'upgrade',
];

// eslint-disable-next-line max-len
export const ALLOWED_HEADERS_FILTER = (name) => !IGNORED_META_OVERRIDES.includes(name.toLowerCase());

/**
 * Applies the custom headers to the response.
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {Response} response
 * @returns {Promise<void>}
 */
export async function applyCustomHeaders(context, info, response) {
  const { config } = context;
  const headers = new ModifiersConfig(config.headers, ALLOWED_HEADERS_FILTER);
  const obj = headers.getModifiers(info.webPath);
  Object.entries(obj).forEach(([name, value]) => {
    response.headers.set(name, value);
  });
  return response;
}

/**
 * Sanitizes the given string by :
 * - convert to lower case
 * - normalize all unicode characters
 * - replace all non-alphanumeric characters with a dash
 * - remove all consecutive dashes
 * - remove all leading and trailing dashes
 *
 * @param {string} name
 * @returns {string} sanitized name
 */
export function sanitizeFolderName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_.]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Sanitizes the path by replacing any invalid characters
 * @param path
 * @param isFolder
 */
export function getSanitizedPath(path, isFolder) {
  const segments = path.split('/');
  if (isFolder) {
    const sanitized = segments.map((name) => sanitizeFolderName(name)).join('/');
    return {
      path: sanitized,
      illegalPath: sanitized !== path.toLowerCase(),
    };
  }

  const filename = segments.pop();
  const idx = filename.lastIndexOf('.');
  const basename = idx >= 0
    ? filename.substring(0, idx)
    : filename;
  const ext = idx >= 0
    ? `.${sanitizeName(filename.substring(idx + 1))}`
    : '';
  const parentPath = segments.map((name) => sanitizeFolderName(name)).join('/');
  return {
    path: `${parentPath}/${sanitizeName(basename)}${ext}`,
    illegalPath: parentPath !== segments.join('/').toLowerCase(),
  };
}

/**
 * Checks if the given path is illegal
 * @param {string} path path
 * @param {boolean} allowBulk whether to allow trailing asterisk
 * @returns {boolean}
 */
export function isIllegalPath(path, allowBulk = false) {
  if (typeof path !== 'string') {
    return true;
  }
  if (path.endsWith('/*')) {
    if (allowBulk) {
      // remove the trailing asterisk
      // eslint-disable-next-line no-param-reassign
      path = path.substring(0, path.length - 1);
    } else {
      return true;
    }
  }
  const { illegalPath } = getSanitizedPath(path);
  return illegalPath;
}

/**
 * Sleep method.
 * @function
 * @param {number} time
 * @return {Promise<void>}
 */
export const sleep = promisify(setTimeout);

/**
 * @typedef PrefixOrPath
 * @property {string} prefix if the input had a trailing '/*', with '*' removed
 * @property {string} path if the input was a verbatim path
 */

/**
 * Process paths passed and simplify where possible.
 *
 * @param {Array<string>} paths path prefixes (with trailing '*') or single paths
 * @returns {Array<PrefixOrPath>} input paths, where children of already mentioned
 * prefix paths are removed
 */
export function processPrefixedPaths(paths) {
  const prefixes = paths
    .map((p) => String(p))
    .filter((p) => p.endsWith('/*'))
    .map((p) => p.substring(0, p.length - 1))
    .sort((p1, p2) => p1.localeCompare(p2))
    .reduce((unique, p) => {
      if (!unique.some((prefix) => p.startsWith(prefix))) {
        unique.push(p);
      }
      return unique;
    }, []);
  const singles = paths
    .map((p) => String(p))
    .filter((p) => !p.endsWith('/*'))
    .reduce((array, p) => {
      if (!prefixes.some((prefix) => p.startsWith(prefix))) {
        array.push(p);
      }
      return array;
    }, []);
  return [
    ...prefixes.map((prefix) => ({ prefix })),
    ...singles.map((single) => ({ path: single })),
  ];
}

/**
 * Coerces the given value to an array. if the value is null or undefined, an empty array is
 * returned.
 * @param {*} value
 * @param {boolean} [unique = false] if true, the resulting array will contain only unique values
 * @return {[]}
 */
export function coerceArray(value, unique = false) {
  if (value === null || value === undefined) {
    return [];
  }
  const array = Array.isArray(value) ? value : [value];
  if (unique) {
    return Array.from(new Set(array));
  }
  return array;
}

/**
 * Log stack of exception if it is "unexpected", e.g. a `TypeError`
 */
export function logStack(log, e) {
  if (e instanceof TypeError) {
    log.debug(e);
  }
}

/**
 * Checks if the given properties are truthy in the given object.
 * Throws error including the message if not.
 *
 * @param {object} obj object
 * @param {string} msg Error message
 * @param {string[]} names
 */
export function assertRequiredProperties(obj, msg, ...names) {
  for (const name of names) {
    if (!obj[name]) {
      throw new Error(`${msg}: "${name}" is required`);
    }
  }
}

/**
 * Gets the deep property of obj denoted by path.
 * @param {object} obj object
 * @param {string} path path
 * @returns {object}
 */
export function getOrCreateObject(obj, path) {
  let o = obj;
  for (const seg of path.split('.')) {
    if (!o[seg]) {
      o[seg] = {};
    }
    o = o[seg];
  }
  return o;
}

/**
 * Resolves the correct allow list based on the config type and relative path within the object.
 *
 * @param {string} type - The type of the config.
 * @param {string} [relPath] - The relative path to the sub-structure within the config,
 * using slash notation.
 * @param {object} allowListConfig - The configuration object mapping types and paths
 * to allow lists.
 * @returns {string[]} - The appropriate allow list for the given type and relPath.
 */
export function resolveAllowList(type, relPath, allowListConfig) {
  let allowList = allowListConfig[type] || [];

  if (relPath) {
    const prefix = `${relPath}/`;
    const prefixLength = prefix.length;

    allowList = allowList
      .filter((path) => path === relPath || path.startsWith(prefix))
      .map((path) => (path === relPath ? '' : path.substring(prefixLength)));
  }

  return allowList;
}

/**
 * Redacts an object based on an allow list. Only the properties in the allow list are kept.
 *
 * This function traverses the provided object (`rawObj`) and retains only those properties
 * that are specified in the `allowList`. The `allowList` should contain property paths in
 * slash notation or bracket notation to indicate nested properties.
 *
 * Example:
 *  const obj = {
 *    a: { b: { c: 1 } },
 *    d: { e: 2 },
 *    f: 3,
 *    g: [{ h: 4 }, { i: 5 }]
 *  };
 *  const allowList = ['a/b/c', 'd/e', 'g[0]/h'];
 *  const result = redactObject(obj, allowList);
 *  // result will be: {
 *  //   a: { b: { c: 1 } },
 *  //   d: { e: 2 },
 *  //   g: [{ h: 4 }]
 *  // }
 *
 * @param {object} rawObj - The object to be redacted. This is the source object from which
 *                          only allowed properties will be copied to the result.
 * @param {string[]} allowList - An array of strings where each string is a path to a property
 *                               that should be retained in the resulting object. Paths can
 *                               be in slash notation (e.g., 'a/b/c') or bracket notation
 *                               (e.g., 'a[b][c]').
 * @returns {object} - A new object containing only the properties specified in the `allowList`.
 */
export function redactObject(rawObj, allowList = []) {
  if (!Array.isArray(allowList)) {
    return {};
  }

  const result = {};

  /**
   * Retrieves the nested value from an object based on the provided path.
   *
   * @param {object} obj - The object to retrieve the value from
   * @param {string[]} path - An array of strings representing the path to the value
   * @returns {*} The value at the specified path, or undefined if the path is invalid
   */
  function getNestedValue(obj, path) {
    return path.reduce((acc, key) => acc?.[key] ?? undefined, obj);
  }

  /**
   * Sets a nested value within an object based on the provided path.
   *
   * @param {object} obj - The object to set the value in
   * @param {string[]} path - An array of strings representing the path to set the value at
   * @param {*} value - The value to set at the specified path
   */
  function setNestedValue(obj, path, value) {
    path.reduce((acc, key, index) => {
      if (index === path.length - 1) {
        acc[key] = value;
      } else if (acc[key] === undefined) {
        // Check if the next path is a number to decide array or object
        acc[key] = Number.isNaN(parseInt(path[index + 1], 10)) ? {} : [];
      }
      return acc[key];
    }, obj);
  }

  for (const keyPath of allowList) {
    if (keyPath === '') {
      Object.assign(result, rawObj);
    } else {
      const pathArray = keyPath.split(/\/|\[|\]/).filter(Boolean);
      const value = getNestedValue(rawObj, pathArray);
      if (value !== undefined) {
        setNestedValue(result, pathArray, value);
      }
    }
  }

  return result;
}

/**
 * Logs and creates an error response.
 * @param {Logger} [log] Logger.
 * @param {number} status The HTTP status. if negative, the status will be turned into a
 *                        gateway status response.
 * @param {string|ErrorInfo} message Error message. if empty, body is used.
 * @param {string} [body = '']
 * @param {object} [headers = {}] optional headers
 * @returns {Response}
 */
export function errorResponse(log, status, message, opts = {}) {
  const { body = '', headers = {} } = opts;
  let codeheader = {};

  if (message?.message) {
    if (message.code) {
      codeheader = { 'x-error-code': message.code };
    }
    // eslint-disable-next-line no-param-reassign
    message = message.message;
  }
  if (!message) {
    // eslint-disable-next-line no-param-reassign
    message = body;
  }
  log[logLevelForStatusCode(Math.abs(status))](message);
  if (status < 0) {
    // eslint-disable-next-line no-param-reassign
    status = propagateStatusCode(-status);
  }
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, private, must-revalidate',
      'x-error': cleanupHeaderValue(message),
      ...headers,
      ...codeheader,
    },
  });
}

export function toSISize(bytes, precision = 2) {
  if (bytes === 0) {
    return '0B';
  }
  const mags = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const LOG_1024 = Math.log(1024);

  const magnitude = Math.floor(Math.log(Math.abs(bytes)) / LOG_1024);
  const result = bytes / (1024 ** magnitude);
  return `${result.toFixed(magnitude === 0 ? 0 : precision)}${mags[magnitude]}`;
}

export function FileSizeFormatter(lang, options) {
  return {
    format: (bytes) => {
      const myoptions = {
        unit: 'byte',
        notation: 'standard',
        unitDisplay: 'long',
        style: 'unit',
        maximumSignificantDigits: 3,
        ...options,
      };
      if (bytes === 0) {
        return new Intl.NumberFormat(lang, myoptions).format(0);
      }
      const mags = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte', 'exabyte'];
      const LOG_1024 = Math.log(1024);

      const magnitude = Math.floor(Math.log(Math.abs(bytes)) / LOG_1024);
      const result = bytes / (1024 ** magnitude);

      myoptions.unit = mags[magnitude];
      return new Intl.NumberFormat(lang, myoptions).format(result);
    },
  };
}

export function formatDuration(duration) {
  const units = [{
    unit: 60, name: 's',
  }, {
    unit: 60, name: 'm',
  }, {
    name: 'h',
  }];

  return units.reduce(({ display, rem }, { unit, name }, i) => {
    if (rem === 0 && i !== 0) {
      return { display, rem };
    }
    const num = unit ? rem % unit : rem;
    return {
      display: `${num}${name} ${display}`,
      rem: Math.floor(unit ? rem / unit : 0),
    };
  }, { display: '', rem: duration }).display.trim();
}

export function* cartesian(...arrays) {
  const len = arrays.length;
  const idx = new Array(len).fill(0);
  let done = false;
  do {
    yield arrays.map((a, i) => a[idx[i]]);
    for (let i = 0; i < len; i += 1) {
      if (idx[i] < arrays[i].length - 1) {
        idx[i] += 1;
        break;
      } else {
        idx[i] = 0;
        if (i === len - 1) {
          done = true;
        }
      }
    }
  } while (!done);
}

/**
 * Returns the name of the queue that contains single messages.
 *
 * @returns {string}
 */
export function getSingleMessageQueue(region, accountId, component, test) {
  return `https://sqs.${region}.amazonaws.com/${accountId}/${test ? 'test' : 'helix'}-${component}`;
}

/**
 * Returns the name of the queue that contains a collection of messages for one project.
 *
 * @returns {string}
 */
export function getPackedMessageQueue(region, accountId, component, test) {
  return `https://sqs.${region}.amazonaws.com/${accountId}/${test ? 'test' : 'helix'}-${component}.fifo`;
}

/**
 * Log request
 *
 * @param {import('./AdminContext').AdminContext} context context
 * @param {import('./RequestInfo').RequestInfo} info request info
 * @param {import('@adobe/fetch').Response} response response
 * @returns {void}
 */
export function logRequest(context, info, response) {
  const { suffix, log } = context;
  const admin = {
    method: info.method,
    route: info.route,
    path: info.webPath,
    suffix,
    status: response.status,
  };
  ['org', 'site'].forEach((key) => {
    if (info[key]) {
      admin[key] = info[key];
    }
  });
  log.info('%j', { admin });
}

/**
 * Simple timing function for async functions.
 * @param f
 * @param timer
 * @returns {Promise<*>}
 */
export async function measure(f, timer) {
  const t0 = Date.now();
  const ret = await f();
  const t1 = Date.now();
  // eslint-disable-next-line no-param-reassign
  timer.time += (t1 - t0);
  return ret;
}
