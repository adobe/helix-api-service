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
import { assertRequiredProperties } from '../../support/utils.js';

/**
 * Default timeout in milliseconds to wait for a response from Akamai.
 */
const DEFAULT_TIMEOUT_MS = 10000; // 10s

const sha256 = async (text) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
};

const hmac = async (secret, data) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder('utf-8')
    .encode(secret).buffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder('utf-8').encode(data).buffer);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
};

async function contentHash(request) {
  /* c8 ignore next */
  const body = request.body || '';
  if (request.method === 'POST' && body.length > 0) {
    return sha256(body);
  }
  /* c8 ignore next */
  return '';
}

async function dataToSign(request, authHeader) {
  const {
    protocol, host, pathname, search,
  } = new URL(request.url);
  const data = [
    request.method.toUpperCase(),
    protocol.replace(':', ''),
    host,
    `${pathname}${search}`,
    '',
    await contentHash(request),
    authHeader,
  ];
  return data.join('\t');
}

async function signRequest(request, timestamp, clientSecret, authHeader) {
  const key = await hmac(clientSecret, timestamp);
  return hmac(key, await dataToSign(request, authHeader));
}

async function computeAuthorizationHeader(config, request) {
  const ts = `${new Date().toISOString().replaceAll('-', '').split('.')[0]}+0000`;
  const nonce = crypto.randomUUID();

  const { clientToken, accessToken, clientSecret } = config;

  const obj = {
    client_token: clientToken,
    access_token: accessToken,
    timestamp: ts,
    nonce,
  };
  let joinedPairs = '';

  Object.entries(obj).forEach(([key, value]) => {
    joinedPairs = `${joinedPairs}${key}=${value};`;
  });

  const authHeader = `EG1-HMAC-SHA256 ${joinedPairs}`;
  const signedAuthHeader = `${authHeader}signature=${await signRequest(request, ts, clientSecret, authHeader)}`;

  return signedAuthHeader;
}

export class AkamaiPurgeClient {
  /**
   * Validates the purge config
   * @param {import('@adobe/helix-admin-support').AkamaiConfig} config
   * @throws {Error} if the config is not valid
   */
  static validate(config) {
    assertRequiredProperties(config, 'invalid purge config', 'host', 'endpoint', 'clientSecret', 'clientToken', 'accessToken');
  }

  /**
   * Returns true if the client supports purging by key, otherwise returns false.
   * @param {import('@adobe/helix-admin-support').AkamaiConfig} config
   * @returns {boolean} always true
   */
  static supportsPurgeByKey(/* config */) {
    return true;
  }

  /**
   * Helper function for sending an Akamai purge request.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('@adobe/helix-admin-support').AkamaiConfig} config Akamai purge config
   * @param {string} type 'url' or 'tag'
   * @param {Array<string>} data urls or tags to purge
   * @returns {Promise<Response>}
   */
  static async sendPurgeRequest(context, config, type, data) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    // timeout signal
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const { signal } = controller;

    const request = {
      url: `https://${config.endpoint}/ccu/v3/delete/${type}/production`,
      method: 'POST',
      headers,
      body: JSON.stringify({ objects: data }),
      signal,
    };
    headers.Authorization = await computeAuthorizationHeader(config, request);
    const fetch = context.getFetch();
    try {
      return fetch(request.url, request);
    } finally {
      // avoid pending timers which prevent node process from exiting
      clearTimeout(timerId);
    }
  }

  /**
   * Purges the Akamai production CDN
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('@adobe/helix-admin-support').AkamaiConfig} config Akamai purge config
   * @param {Object} params purge parameters
   * @param {Array<string>} [params.keys] keys (tags) to purge
   * @param {Array<string>} [params.paths] url paths to purge
   */
  static async purge(context, config, { keys, paths }) {
    const { log, suffix } = context;
    const { host } = config;

    let msg;
    let resp;
    if (paths?.length) {
      const urls = paths.map((path) => `https://${host}${path}`);
      const id = context.nextRequestId();
      try {
        /* c8 ignore next */
        log.info(`${suffix} [${id}] [akamai] ${host} purging urls '${urls}'`);
        resp = await AkamaiPurgeClient.sendPurgeRequest(context, config, 'url', urls);
      } /* c8 ignore next 4 */ catch (err) {
        msg = `${suffix} [${id}] [akamai] ${host} url purge failed: ${err}`;
        log.error(msg);
        throw new Error(msg);
      }
      const result = await resp.text();
      if (resp.ok) {
        /* c8 ignore next */
        log.info(`${suffix} [${id}] [akamai] ${host} url purge succeeded: ${resp.status} - ${result}`);
      } else {
        /* c8 ignore next */
        msg = `${suffix} [${id}] [akamai] ${host} url purge failed: ${resp.status} - ${result}`;
        log.error(msg);
        throw new Error(msg);
      }
    }

    if (keys?.length) {
      const id = context.nextRequestId();
      try {
        /* c8 ignore next */
        log.info(`${suffix} [${id}] [akamai] ${host} purging keys '${keys}'`);
        resp = await AkamaiPurgeClient.sendPurgeRequest(context, config, 'tag', keys);
      } /* c8 ignore next 4 */ catch (err) {
        msg = `${suffix} [${id}] [akamai] ${host} key purge failed: ${err}`;
        log.error(msg);
        throw new Error(msg);
      }
      const result = await resp.text();
      if (resp.ok) {
        /* c8 ignore next */
        log.info(`${suffix} [${id}] [akamai] ${host} key purge succeeded: ${resp.status} - ${result}`);
      } else {
        /* c8 ignore next */
        msg = `${suffix} [${id}] [akamai] ${host} key purge failed: ${resp.status} - ${result}`;
        log.error(msg);
        throw new Error(msg);
      }
    }
  }
}
