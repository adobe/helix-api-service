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
import { AccessDeniedError } from '../auth/AccessDeniedError.js';
import { coerceArray } from '../support/utils.js';
import { getConfigJsonResponse } from './utils.js';

export const TRUSTED_ORIGINS = [
  'https://labs.aem.live',
  'https://tools.aem.live',
  'http://localhost:3000',
];

function isAdobeTrustedCrossOrigin(origin) {
  if (TRUSTED_ORIGINS.includes(origin)) {
    return true;
  }

  const TRUSTED_ORIGIN_PATTERNS = [
    /^https:\/\/[a-z0-9-]+--helix-labs-website--adobe\.aem\.(page|live|reviews)$/, // labs
    /^https:\/\/[a-z0-9-]+--helix-tools-website--adobe\.aem\.(page|live|reviews)$/, // tools
  ];

  if (TRUSTED_ORIGIN_PATTERNS.some((trustedOriginPattern) => origin.match(trustedOriginPattern))) {
    return true;
  }

  return false;
}

const TRUSTED_ORIGINS_BY_CONTENT_SOURCE = {
  'https://drive.google.com': ['https://docs.google.com'],
  'https://content.da.live': ['https://da.live'],
};

export const SIDEKICK_CSRF_PROTECTION_CONFIG = {
  enabled: true, // killswitch
  exceptedOrgs: [
    'adobecom',
    'pfizer',
    'sap',
    'celonis',
    'wesco-international',
  ],
  exceptedSites: [
    'aemsites/wellmark-prod-conf',
  ],
};

function logRejection(log, extensionId, org, site, origin, message, suffix, referer) {
  log.warn('%j', {
    csrf: {
      org: org || '_top_level_',
      site: org ? site || '_org_level_' : '',
      origin: origin || '_missing_origin_',
      extensionId,
      message: `[CSRF Protection] ${message}`,
      suffix,
      referer,
    },
  });
}

/**
 * Checks if a host is valid
 * - only alphanumeric, dash, dot, and * for globbing
 * - globbing is only allowed in the subdomains
 * @param {string} host The host to check
 * @returns {boolean} Whether the host is valid
 */
function checkHost(host) {
  if (!host || typeof host !== 'string') {
    return false;
  }

  if (host.length > 253) {
    return false; // avoid regex DoS
  }

  // check for invalid characters and invalid character combinations
  if (/[^a-zA-Z0-9\-.*]/.test(host) || host.includes('**') || host.includes('..')) {
    return false;
  }

  // globbing is only allowed in the subdomains and maximum 2 globbing characters
  if (host.includes('*')) {
    if ([...host].filter((c) => c === '*').length > 2) {
      return false;
    }

    const parts = host.split('.');
    if (parts.length < 3 || parts[parts.length - 1].includes('*') || parts[parts.length - 2].includes('*')) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if a origin matches a host pattern that may include a glob
 * @param {string} origin The origin to check
 * @param {string} pattern The host pattern to match against
 * @returns {boolean} Whether the host matches the pattern
 */
function hostMatches(origin, pattern) {
  if (pattern.includes('*')) {
    const regex = new RegExp(`^https://${pattern.replaceAll('.', '\\.').replaceAll('*', '[a-zA-Z0-9\\-\\.]{0,63}')}$`);
    return regex.test(origin);
  }
  return origin === `https://${pattern}`;
}

/**
 * Mitigates CSRF attacks through the sidekick token injection
 * by validating that the request comes from a trusted origin from the browser.
 * https://github.com/adobe/helix-admin/issues/2654
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
  *
 * @throws {AccessDeniedError} if the request is not from a trusted origin
 * @returns {Promise<void>}
 */
export async function sidekickCSRFProtection(context, info) {
  if (!SIDEKICK_CSRF_PROTECTION_CONFIG.enabled) {
    return;
  }

  const { headers = {} } = info;
  const { log, attributes: { authInfo } } = context;

  if (!authInfo || !authInfo.authenticated || !authInfo.extensionId) {
    // CSRF only applies to authenticated requests
    return;
  }

  const { extensionId } = authInfo;

  const { org, site } = info;
  const { suffix, method } = info;

  const { origin, referer } = headers;
  try {
    if (!origin) {
      if (['GET', 'HEAD'].includes(method) && headers['sec-fetch-mode'] === 'cors') {
        /*
         Requests coming from extension background workers do not have an Origin for GET and HEAD
         method, but they will still have the `sec-fetch-mode` header set to `cors`.
         https://issues.chromium.org/issues/373672159
        */
        return;
      } else if (!headers['sec-fetch-mode']) {
        /*
          Non browser requests. e.g. backends, curl, postman.
          Browsers send the `sec-fetch-mode` header
          and cannot be remove by client side code (Baseline 2023).
        */
        return;
      } else {
        logRejection(log, extensionId, org, site, null, `${org}/${site}: missing origin`, suffix, referer);
        throw new AccessDeniedError('untrusted origin. missing origin');
      }
    }

    if (origin.length > 270) {
      // avoid regex DoS
      logRejection(log, extensionId, org, site, origin, `rejecting untrusted origin: ${origin}`, suffix, referer);
      throw new AccessDeniedError(`untrusted origin for site "${org}/${site}". "${origin}"`);
    }

    if (isAdobeTrustedCrossOrigin(origin)) {
      return; // always allow
    }

    if (origin === `chrome-extension://${extensionId}`) {
      return; // allow extension's page and background workers
    }

    if (!org && !site) {
      // top level path (e.g. /profile) - only allow Adobe trusted origins
      logRejection(log, extensionId, null, null, origin, `top-level: rejecting untrusted origin: ${origin}`, suffix, referer);
      throw new AccessDeniedError(`untrusted origin at top-level. "${origin}"`);
    }

    if (!site) {
      // org level request
      const orgTrustedOrigins = origin.match(new RegExp(`^https://[a-z0-9-]+--[a-z0-9-]+--${org}\\.(aem|hlx)\\.(page|live|reviews)$`));
      if (!orgTrustedOrigins) {
        logRejection(log, extensionId, org, null, origin, `${org}: rejecting untrusted origin: ${origin}`, suffix, referer);
        throw new AccessDeniedError(`untrusted origin for org "${org}". "${origin}"`);
      }
      return;
    }

    const siteOrigin = origin.match(new RegExp(`^https://[a-z0-9-]+--${site}--${org}\\.(aem|hlx)\\.(page|live|reviews)$`));
    if (siteOrigin) {
      return;
    }

    const result = await getConfigJsonResponse(context, info);

    const { sidekick } = result;
    const {
      previewHost, liveHost, reviewHost, contentSourceUrl, host,
    } = sidekick;

    const contentSourceOrigin = new URL(contentSourceUrl).origin;

    const customOrigins = [host, previewHost, liveHost, reviewHost]
      .filter((customHost) => !!customHost)
      .map((customHost) => `https://${customHost}`)
      .concat(contentSourceOrigin)
      .concat(...coerceArray(TRUSTED_ORIGINS_BY_CONTENT_SOURCE[contentSourceOrigin]));

    if (customOrigins.includes(origin)) {
      return;
    }

    const trustedHosts = context.attributes.config?.limits?.admin?.trustedHosts;

    if (coerceArray(trustedHosts)
      .filter(checkHost)
      .some((trustedHost) => hostMatches(origin, trustedHost))) {
      return;
    }

    logRejection(log, extensionId, org, site, origin, `${org}/${site}: rejecting untrusted origin: ${origin}`, suffix, referer);
    throw new AccessDeniedError(`untrusted origin for site "${org}/${site}". "${origin}"`);
  } catch (e) {
    if (e instanceof AccessDeniedError) {
      if (SIDEKICK_CSRF_PROTECTION_CONFIG.exceptedOrgs.includes(org) || SIDEKICK_CSRF_PROTECTION_CONFIG.exceptedSites.includes(`${org}/${site}`)) {
        // temporary opt-out mechanism - log and allow
        return;
      }
      throw e;
    }
    logRejection(log, extensionId, org, site, origin, `${org}/${site}: unknown error: ${e}`, suffix, referer);
  }
}
