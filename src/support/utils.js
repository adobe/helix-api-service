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
import { sanitizeName } from '@adobe/helix-shared-string';

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
 * @param path
 * @param allowBulk
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
