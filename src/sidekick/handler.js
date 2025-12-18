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
import { createErrorResponse } from '../contentbus/utils.js';
import { coerceArray } from '../support/utils.js';
import { AccessDeniedError } from '../auth/AccessDeniedError.js';

function replaceParams(str, info) {
  return str
    .replaceAll('$owner', info.owner)
    .replaceAll('$repo', info.repo)
    .replaceAll('$ref', info.ref)
    .replaceAll('$site', info.site)
    .replaceAll('$org', info.org);
}

/**
 * Returns the sidekick config.json response.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @return {Promise<object>}
 */
async function getConfigJsonResponse(context, info) {
  const { attributes: { config } } = context;

  const sidekick = config.sidekick ?? {};
  if (!sidekick.previewHost) {
    sidekick.previewHost = config.cdn?.preview?.host;
  }
  if (!sidekick.previewHost) {
    sidekick.previewHost = '$ref--$site--$org.aem.page';
  }
  if (!sidekick.liveHost) {
    sidekick.liveHost = config.cdn?.live?.host;
  }
  if (!sidekick.liveHost) {
    sidekick.liveHost = '$ref--$site--$org.aem.live';
  }
  if (!sidekick.reviewHost) {
    sidekick.reviewHost = config.cdn?.review?.host;
  }
  if (config.cdn?.prod?.route) {
    sidekick.routes = config.cdn?.prod?.route;
  }
  sidekick.previewHost = replaceParams(sidekick.previewHost, info);
  sidekick.liveHost = replaceParams(sidekick.liveHost, info);
  if (sidekick.reviewHost) {
    sidekick.reviewHost = replaceParams(sidekick.reviewHost, info);
  }
  sidekick.contentSourceUrl = config.content.source.url;
  sidekick.contentSourceType = config.content.source.type;
  sidekick.host = config.cdn?.prod?.host;
  sidekick.project = sidekick.project || config.title;

  return { error: false, sidekick };
}

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

  let { org, site } = info;
  const { suffix, method } = info;
  if (info.route === 'config') {
    // special case for the config route
    [, , org, , site] = info.suffix.split('.')[0].split(/\/+/);
  }

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

    const { attributes: { config } } = context;
    const trustedHosts = config.limits?.admin?.trustedHosts;

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

/**
 * Handles the sidekick route
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function sidekickHandler(context, info) {
  const { attributes: { authInfo }, log } = context;

  if (info.method !== 'GET') {
    return new Response('method not allowed', {
      status: 405,
    });
  }

  if (info.webPath === '/config.json') {
    authInfo.assertPermissions('code:read');
    const result = await getConfigJsonResponse(context, info);
    if (!result.error) {
      const { sidekick } = result;
      return new Response(JSON.stringify(sidekick), {
        headers: {
          'cache-control': 'no-store, private, must-revalidate',
          'content-type': 'application/json; charset=utf-8',
        },
      });
    }
    const { status, msg } = result;
    return createErrorResponse({ log, status, msg });
  }

  return createErrorResponse({
    log,
    status: 404,
    msg: 'not found',
  });
}
