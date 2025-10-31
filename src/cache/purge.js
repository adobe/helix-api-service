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

/* eslint-disable max-len, no-bitwise */

import { Response } from '@adobe/fetch';
import processQueue from '@adobe/helix-shared-process-queue';
import { computeSurrogateKey, logLevelForStatusCode, propagateStatusCode } from '@adobe/helix-shared-utils';
import {
  CONFIG_JSON_PATH, getMetadataPaths,
  HEADERS_JSON_PATH, METADATA_JSON_PATH,
} from '../contentbus/contentbus.js';
import { querySiblingSites } from '../discover/cdn-identifier.js';
import { cartesian } from '../support/utils.js';
import { AkamaiPurgeClient } from './clients/akamai.js';
import { CloudflarePurgeClient } from './clients/cloudflare.js';
import { CloudfrontPurgeClient } from './clients/cloudfront.js';
import { FastlyPurgeClient } from './clients/fastly.js';
import { ManagedPurgeClient } from './clients/managed.js';
import resolve from './resolve.js';
import { removeRedundantKeys, removeRedundantPaths, sleep } from './utils.js';
import { loadSiteConfig } from '../config/utils.js';

export const PURGE_LIVE = 1;
export const PURGE_PREVIEW = 2;
export const PURGE_CONFIG = 4;
export const PURGE_PREVIEW_AND_LIVE = PURGE_PREVIEW | PURGE_LIVE;

const HLX_LIVE_SERVICE_ID = '1PluOUd9jqp1prQ8PHd85n'; // hlx.live
const AEM_LIVE_SERVICE_ID = 'In8SInYz3UQGjyG0GPZM42'; // aem.live

const LIVE_PURGE_CONFIG = {
  owner: '*',
  repo: '*',
  services: [
    HLX_LIVE_SERVICE_ID,
    AEM_LIVE_SERVICE_ID,
  ],
  domains: [
    '{ref}--{repo}--{owner}.hlx.live',
    '{ref}--{repo}--{owner}.hlx-fastly.live',
    '{ref}--{site}--{org}.aem.live',
    '{ref}--{site}--{org}.aem-fastly.live',
  ],
};

const AEM_PAGE_SERVICE_ID = AEM_LIVE_SERVICE_ID; // aem.page

const PREVIEW_PURGE_CONFIG = {
  owner: '*',
  repo: '*',
  services: [
    AEM_PAGE_SERVICE_ID,
  ],
  domains: [
    '{ref}--{site}--{org}.aem.page',
    '{ref}--{site}--{org}.aem-fastly.page',
  ],
};

const CONFIG_AEM_PAGE_SERVICE_ID = 'SIDuP3HxleUgBDR3Gi8T24'; // config.aem.page

const CONFIG_PURGE_CONFIG = {
  owner: '*',
  repo: '*',
  services: [
    CONFIG_AEM_PAGE_SERVICE_ID,
  ],
  domains: [
    'config.aem.page',
    'config.aem-fastly.page',
  ],
};

// service names for logging
const SERVICE_NAMES = {
  [HLX_LIVE_SERVICE_ID]: 'hlx.live',
  [AEM_LIVE_SERVICE_ID]: 'aem.(live|page)',
  [CONFIG_AEM_PAGE_SERVICE_ID]: 'config.aem.page',
};

/**
 * @typedef PurgeClient
 * @function validate
 * @function purge
 */

/**
 * @type {PurgeClient[]}
 */
const PURGE_CLIENTS = {
  fastly: FastlyPurgeClient,
  cloudflare: CloudflarePurgeClient,
  akamai: AkamaiPurgeClient,
  cloudfront: CloudfrontPurgeClient,
  managed: ManagedPurgeClient,
};

/**
 * @typedef PurgeInfo
 * @param {string} path path of resource to purge. `undefined` for surrogate purge
 * @param {string} key  surrogate-key to purge. `undefined` for url based purge
 */

/**
 * Returns the purge paths for a given resource
 * @param {string|string[]} paths the paths
 * @returns {string[]} the path variants
 */
export function getPurgePathVariants(paths) {
  if (!Array.isArray(paths)) {
    // eslint-disable-next-line no-param-reassign
    paths = [paths];
  }
  const variants = [];
  paths.forEach((path) => {
    variants.push(path);
    // also purge respective .plain.html
    const lastSlash = path.lastIndexOf('/');
    const lastDot = path.lastIndexOf('.');
    if (lastDot < lastSlash) {
      if (lastSlash === path.length - 1) {
        variants.push(`${path}index.plain.html`);
      } else {
        variants.push(`${path}.plain.html`);
      }
    }
  });
  return variants;
}

/**
 * Returns the fastly services and domains to purge for the given info and scope
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {Number} scope PURGE_PREVIEW, PURGE_LIVE, PURGE_PREVIEW_AND_LIVE or PURGE_CONFIG
 * @returns {object} purge config
 */
function getFastlyPurgeConfig(info, scope) {
  const replaceProps = (str) => str
    .replace(/\{owner}/g, info.owner)
    .replace(/\{repo}/g, info.repo)
    .replace(/\{org}/g, info.org)
    .replace(/\{site}/g, info.site)
    .replace(/\{ref}/g, info.ref);

  // always append default svc and domain
  const domains = [];
  const services = [];

  if (scope & PURGE_LIVE) {
    domains.push(...LIVE_PURGE_CONFIG.domains);
    services.push(...LIVE_PURGE_CONFIG.services);
  }
  if (scope & PURGE_PREVIEW) {
    domains.push(...PREVIEW_PURGE_CONFIG.domains);
    services.push(...PREVIEW_PURGE_CONFIG.services);
  }
  if (scope & PURGE_CONFIG) {
    domains.push(...CONFIG_PURGE_CONFIG.domains);
    services.push(...CONFIG_PURGE_CONFIG.services);
  }

  return {
    services: [...new Set(services)], // remove duplicate entries
    domains: domains.map(replaceProps),
  };
}
/**
 * Purges the production CDN
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('@adobe/helix-admin-support').ProjectCDNConfig} cdnConfig CDN configuration
 * @param {Object} params purge parameters
 * @param {Array<string>} [params.keys] keys (tags) to purge
 * @param {Array<string>} [params.paths] paths (tags) to purge
 */
async function purgeProductionCDN(context, cdnConfig, { keys, paths }) {
  const { host, type } = cdnConfig;

  /* c8 ignore next 3 */
  if ((!keys || !keys.length) && (!paths || !paths.length)) {
    return;
  }

  const client = PURGE_CLIENTS[type];
  if (!client) {
    throw new Error(`Unsupported 'cdn.prod.type' value: ${type}`);
  }
  try {
    client.validate(cdnConfig);
  } catch (e) {
    // ignore the production purge since customers might have
    // deliberately configured their setup only partially
    context.log.warn(`ignoring production cdn purge config for type "${type}": ${e.message}`);
    return;
  }

  const details = [`[${type}] purging production CDN on ${host}`];
  if (keys) {
    /* c8 ignore next */
    const keysDisplayed = keys.length <= 10 ? keys : keys.slice(0, 10).concat('...');
    details.push(`keys: [${keysDisplayed.join(',')}]`);
  }
  if (paths) {
    /* c8 ignore next */
    const pathsDisplayed = paths.length <= 10 ? paths : paths.slice(0, 10).concat('...');
    details.push(`paths: [${pathsDisplayed.join(',')}]`);
  }
  context.attributes.details.push(...details);
  await client.purge(context, cdnConfig, { keys, paths });
}

/**
 * Purge a production CDN given its configuration.
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {String} ref ref
 * @param {String} contentBusId content bus id
 * @param {String[]} errResponses responses
 * @param {import('@adobe/helix-admin-support').ProjectCDNConfig} cdnConfig CDN configuration
 * @param {PurgeInfo[]} prodPurgeInfo production purge information
 */
async function purgeProductionCDNConfig(context, info, ref, contentBusId, errResponses, cdnConfig, prodPurgeInfo) {
  const { log, suffix, attributes } = context;
  const { owner, repo } = info;

  let optimizedPurgeInfo = prodPurgeInfo;
  if (cdnConfig.type) {
    const client = PURGE_CLIENTS[cdnConfig.type];
    if (client) {
      if (!client.supportsPurgeByKey(cdnConfig)) {
        // remove redundant keys:
        // remove path-based surrogate key if the corresponding path is purged also
        optimizedPurgeInfo = await removeRedundantKeys({
          contentBusId,
          ref,
          repo,
          owner,
        }, { keys: prodPurgeInfo.keys, paths: prodPurgeInfo.paths });
      } else {
        // remove redundant paths:
        // remove path if corresponding path-based surrogate key is present
        optimizedPurgeInfo = await removeRedundantPaths({
          contentBusId,
          ref,
          repo,
          owner,
        }, { keys: prodPurgeInfo.keys, paths: prodPurgeInfo.paths });
      }
    }
    if (client && (optimizedPurgeInfo.keys?.length || optimizedPurgeInfo.paths?.length)) {
      // 0.5s grace period for purges to be propagated
      await sleep(/* c8 ignore next */ attributes.gracePeriod ?? 500);
    }
    // BYO CDN purge
    try {
      await purgeProductionCDN(context, cdnConfig, optimizedPurgeInfo);
    } catch (err) {
      /* c8 ignore next */
      const msg = `${suffix} failed to purge production cdn ${cdnConfig.host}: ${err}`;
      attributes.errors.push(msg);
      log.error(msg);
      errResponses.push(new Response('error from helix-purge', {
        status: 502,
      }));
    }
  }
}

/**
 * Purges the dual-stack Cloudflare zones *.(aem|hlx)(-cloudflare)?.(live|page)
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {Object} params purge parameters
 * @param {Array<string>} [params.keys] keys (tags) to purge
 * @param {Array<string>} [params.paths] paths (tags) to purge
 * @param {Number} scope PURGE_PREVIEW, PURGE_LIVE or PURGE_PREVIEW_AND_LIVE
 */
async function purgeCloudflareZones(context, info, { keys, paths }, scope) {
  /* c8 ignore next 3 */
  if ((!keys || !keys.length) && (!paths || !paths.length)) {
    return;
  }

  // purge cloudflare outer cdn
  const {
    owner, repo, org, site, ref,
  } = info;

  const {
    CLOUDFLARE_PURGE_TOKEN,
    HLX_LIVE_ZONE_ID,
    HLX_CLOUDFLARE_LIVE_ZONE_ID,
    AEM_LIVE_ZONE_ID,
    AEM_PAGE_ZONE_ID,
    AEM_CLOUDFLARE_LIVE_ZONE_ID,
    AEM_CLOUDFLARE_PAGE_ZONE_ID,
  } = context.env;

  if (!CLOUDFLARE_PURGE_TOKEN) {
    return;
  }

  const cfgs = [];

  if (scope & PURGE_LIVE) {
    // live
    // only purge if the hostname resolves to a cloudflare zone
    if (await resolve.isCloudflareZone(context, `main--${site}--${org}.hlx.live`)) {
      if (HLX_CLOUDFLARE_LIVE_ZONE_ID) {
        // *.hlx-cloudflare.live
        cfgs.push({
          cdn: {
            prod: {
              type: 'cloudflare',
              plan: 'enterprise',
              host: `${ref}--${site}--${org}.hlx-cloudflare.live`,
              zoneId: HLX_CLOUDFLARE_LIVE_ZONE_ID,
              apiToken: CLOUDFLARE_PURGE_TOKEN,
            },
          },
          prefix: `${ref}--${repo}--${owner}`,
        });
      }
      if (HLX_LIVE_ZONE_ID) {
        // *.hlx.live
        cfgs.push({
          cdn: {
            prod: {
              type: 'cloudflare',
              plan: 'enterprise',
              host: `${ref}--${site}--${org}.hlx.live`,
              zoneId: HLX_LIVE_ZONE_ID,
              apiToken: CLOUDFLARE_PURGE_TOKEN,
            },
          },
          prefix: `${ref}--${repo}--${owner}`,
        });
      }
    }

    // only purge if the hostname resolves to a cloudflare zone
    if (await resolve.isCloudflareZone(context, `main--${site}--${org}.aem.live`)) {
      if (AEM_CLOUDFLARE_LIVE_ZONE_ID) {
        // *.aem-cloudflare.live
        cfgs.push({
          cdn: {
            prod: {
              type: 'cloudflare',
              plan: 'enterprise',
              host: `${ref}--${site}--${org}.aem-cloudflare.live`,
              zoneId: AEM_CLOUDFLARE_LIVE_ZONE_ID,
              apiToken: CLOUDFLARE_PURGE_TOKEN,
            },
          },
          prefix: `${ref}--${site}--${org}`,
        });
      }
      if (AEM_LIVE_ZONE_ID) {
        // *.aem.live
        cfgs.push({
          cdn: {
            prod: {
              type: 'cloudflare',
              plan: 'enterprise',
              host: `${ref}--${site}--${org}.aem.live`,
              zoneId: AEM_LIVE_ZONE_ID,
              apiToken: CLOUDFLARE_PURGE_TOKEN,
            },
          },
          prefix: `${ref}--${site}--${org}`,
        });
      }
    }
  }

  if (scope & PURGE_PREVIEW) {
    // preview
    // only purge if the hostname resolves to a cloudflare zone
    if (await resolve.isCloudflareZone(context, `main--${site}--${org}.aem.page`)) {
      if (AEM_CLOUDFLARE_PAGE_ZONE_ID) {
        // *.aem-cloudflare.page
        cfgs.push({
          cdn: {
            prod: {
              type: 'cloudflare',
              plan: 'enterprise',
              host: `${ref}--${site}--${org}.aem-cloudflare.page`,
              zoneId: AEM_CLOUDFLARE_PAGE_ZONE_ID,
              apiToken: CLOUDFLARE_PURGE_TOKEN,
            },
          },
          prefix: `${ref}--${site}--${org}`,
        });
      }
      if (AEM_PAGE_ZONE_ID) {
        // *.aem.page
        cfgs.push({
          cdn: {
            prod: {
              type: 'cloudflare',
              plan: 'enterprise',
              host: `${ref}--${site}--${org}.aem.page`,
              zoneId: AEM_PAGE_ZONE_ID,
              apiToken: CLOUDFLARE_PURGE_TOKEN,
            },
          },
          prefix: `${ref}--${site}--${org}`,
        });
      }
    }
  }

  if (scope & PURGE_CONFIG) {
    // config
    // only purge if config.aem.page resolves to a cloudflare zone
    if (await resolve.isCloudflareZone(context, 'config.aem.page')) {
      if (AEM_PAGE_ZONE_ID) {
        // *.aem.page
        cfgs.push({
          cdn: {
            prod: {
              type: 'cloudflare',
              plan: 'enterprise',
              host: 'config.aem.page',
              zoneId: AEM_PAGE_ZONE_ID,
              apiToken: CLOUDFLARE_PURGE_TOKEN,
            },
          },
        });
      }
    }
    // allways purge config.aem-cloudflare.page since it is requuested by pipeline worker (indepenent of zone mapping)
    if (AEM_CLOUDFLARE_PAGE_ZONE_ID) {
      // *.aem-cloudflare.page
      cfgs.push({
        cdn: {
          prod: {
            type: 'cloudflare',
            plan: 'enterprise',
            host: 'config.aem-cloudflare.page',
            zoneId: AEM_CLOUDFLARE_PAGE_ZONE_ID,
            apiToken: CLOUDFLARE_PURGE_TOKEN,
          },
        },
      });
    }
  }

  await Promise.all(cfgs.map(
    async (cfg) => {
      // the cloudflare zones use special cache keys for paths
      const prefixedPaths = paths ? paths.map((p) => `${cfg.prefix || ''}${p}`) : undefined;
      const cdnConfig = cfg.cdn?.prod;
      if (cdnConfig) {
        await purgeProductionCDN(context, cdnConfig, { paths: prefixedPaths, keys });
      }
    },
  ));
}

/**
 * Return all production CDN configurations for a given list of sites.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('../discover/cdn-identifier.js').ProductionSite[]} sites sites
 * @returns {Promise<import('@adobe/helix-admin-support').ProjectCDNConfig[]>} CDN configurations
 */
async function fetchProductionCDNConfigs(context, info, sites) {
  const cdnConfigs = await processQueue([...sites], async (site) => {
    if (site.org === info.org && site.site === info.site) {
      // optimization for *this* repository
      return context.attributes.config?.cdn?.prod;
    } else {
      const config = await loadSiteConfig(context, site.org, site.site);
      return config?.cdn?.prod;
    }
  });
  return cdnConfigs.filter((cdnConfig) => !!cdnConfig);
}

const purge = {
  /**
   * Purges the resource using the given surrogate key(s)
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {Array<string>} keys the surrogate key(s)
   * @param {Number} scope PURGE_PREVIEW, PURGE_LIVE or PURGE_PREVIEW_AND_LIVE
   * @returns {Promise<Response>} response
   */
  surrogate: async (context, info, keys, scope = PURGE_LIVE) => {
    const { log, env: { HLX_FASTLY_PURGE_TOKEN: fastlyKey }, suffix } = context;
    if (!fastlyKey) {
      log.error('unable to perform surrogate purge. no HLX_FASTLY_PURGE_TOKEN configured.');
      return new Response('', {
        status: 500,
        headers: {
          'x-error': 'purge token missing.',
        },
      });
    }

    // get the fastly services for the given owner/repo
    const config = getFastlyPurgeConfig(info, scope);
    const fetch = context.getFetch();

    // prepare payloads (only 256 keys can be purged at once)
    // https://developer.fastly.com/reference/api/purging/#bulk-purge-tag
    const payloads = [];
    const surrogateKeys = [...keys];
    while (surrogateKeys.length) {
      payloads.push({
        surrogate_keys: surrogateKeys.splice(0, 256),
      });
    }

    // for all services, send all payloads
    const result = await processQueue(cartesian(config.services, payloads), async ([svc, body]) => {
      // eslint-disable-next-line no-plusplus
      const id = context.nextRequestId();
      const url = `https://api.fastly.com/service/${svc}/purge`;
      log.info(`${suffix} [${id}] [fastly] ${SERVICE_NAMES[svc]} purging keys: '${body.surrogate_keys}'`);
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'fastly-key': fastlyKey,
        },
      });
      const msg = await res.text();
      if (res.ok) {
        log.info(`${suffix} [${id}] [fastly] response: ${res.status}: ${msg}`);
      } else {
        const level = logLevelForStatusCode(res.status);
        /* c8 ignore next */
        log[level](`${suffix} [${id}] [fastly] response: ${res.status}: ${msg}`);
      }
      return res.status;
    }, 32);

    if (result.some((status) => status >= 300)) {
      // sort result status descending (so we get the most serious errors first)
      result.sort((a, b) => b - a);
      return new Response('error from helix-purge', {
        status: propagateStatusCode(result[0]),
      });
    }

    return new Response('', {
      status: 200,
    });
  },

  /**
   * Purges the resource using the given path(s)
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {Array<string>} paths the paths to purge
   * @param {Number} scope PURGE_PREVIEW, PURGE_LIVE or PURGE_PREVIEW_AND_LIVE
   * @returns {Promise<Response>} response
   */
  url: async (context, info, paths, scope = PURGE_LIVE) => {
    const { log, env: { HLX_FASTLY_PURGE_TOKEN: fastlyKey }, suffix } = context;
    const config = getFastlyPurgeConfig(info, scope);
    const fetch = context.getFetch();

    const result = await processQueue(cartesian(config.domains, paths), async ([host, path]) => {
      // eslint-disable-next-line no-plusplus
      const id = context.nextRequestId();
      const url = `https://api.fastly.com/purge/${host}${path}`;
      /* c8 ignore next */
      log.info(`${suffix} [${id}] [fastly] ${host} purging url '${path}'`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'fastly-key': fastlyKey,
        },
      });
      const msg = await res.text();
      if (res.ok) {
        /* c8 ignore next */
        log.info(`${suffix} [${id}] [fastly] response: ${res.status}: ${msg}`);
      } else {
        const level = logLevelForStatusCode(res.status);
        /* c8 ignore next */
        log[level](`${suffix} [${id}] [fastly] response: ${res.status}: ${msg}`);
      }
      return res.status;
    }, 32);

    if (result.some((status) => status >= 300)) {
      // sort result status descending (so we get the most serious errors first)
      result.sort((a, b) => b - a);
      return new Response('error from helix-purge', {
        status: propagateStatusCode(result[0]),
      });
    }

    return new Response('', {
      status: 200,
    });
  },

  /**
   * Purges the resources with the given purge infos
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {Array<PurgeInfo>} infos the purge infos
   * @param {Number} scope PURGE_PREVIEW, PURGE_LIVE or PURGE_PREVIEW_AND_LIVE
   * @param {string} [ref = 'main'] repository 'ref' to use for purge. defaults to `main`.
   * @param {import('../discover/cdn-identifier.js').ProductionSite[]} sites sibling sites
   * @returns {Promise<Response>} response
   */
  perform: async (context, info, infos, scope, ref = 'main', sites = []) => {
    const { attributes: { config }, log, suffix } = context;
    const { content: { contentBusId } } = config;

    // split the infos into surrogate and path purges (make sure to remove duplicates)
    const ka = [...new Set(infos.filter((i) => !!i.key).map(({ key }) => key))];
    const pa = [...new Set(infos.filter((i) => !!i.path).map(({ path }) => path))];

    // save the production purge payload for later
    const prodPurgeInfo = {
      keys: [...ka],
      paths: [...pa],
    };

    // create new path info with the ref given. this allows code-purges to force a purge of the branch
    const forcedInfo = {
      ...info,
      ref,
    };

    const {
      repo,
      owner,
    } = info;

    // remove redundant paths:
    // remove path if corresponding path-based surrogate key is present
    const { keys, paths } = await removeRedundantPaths({
      contentBusId,
      ref,
      repo,
      owner,
    }, { keys: ka, paths: pa });

    log.info(`${suffix} [performPurge] purging keys: '${keys}', paths: '${paths}'`);

    const tasks = [];
    if (keys.length) {
      tasks.push(purge.surrogate(context, info, keys, scope));
    }
    if (paths.length) {
      tasks.push(purge.url(context, forcedInfo, paths, scope));
    }
    /* c8 ignore next 3 */
    if (!tasks.length) {
      tasks.push(Promise.resolve(new Response('', { status: 200 })));
    }
    const errResponses = (await Promise.all(tasks)).filter((resp) => resp.status !== 200);

    // purge cloudflare zones
    try {
      await purgeCloudflareZones(context, info, { keys, paths }, scope);
    } catch (err) {
      log.error(`failed to purge cloudflare zone: ${err}`);
      errResponses.push(new Response('error from helix-purge', {
        status: 502,
      }));
    }

    // don't purge production CDN for code pushes on a branch other than main
    if (info.ref !== 'main') {
      log.info(`${suffix} ignoring production purge on non-main branch '${info.ref}'`);
    } else if (!(scope & PURGE_LIVE)) {
      /* c8 ignore next */
      log.info(`${suffix} ignoring production purge when scope does not include live: '${scope}'`);
    } else {
      const cdnConfigs = await fetchProductionCDNConfigs(
        context,
        info,
        [...sites, { org: info.org, site: info.site }],
      );
      await processQueue(
        cdnConfigs,
        (cdnConfig) => purgeProductionCDNConfig(context, info, ref, contentBusId, errResponses, cdnConfig, prodPurgeInfo),
      );
    }

    if (errResponses.length) {
      return errResponses[0];
    }

    return new Response('', {
      status: 200,
    });
  },

  /**
   * Purges the respective config changes
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} opts request info
   * @returns {Promise<Response>}
   */
  config: async (context, opts) => {
    const {
      owner = opts.org,
      repo = opts.site,
      ref = 'main',
      org,
      site,
      keys = [],
      purgeOrg,
      purgeHead,
    } = opts;
    const info = {
      owner, repo, org, site, ref,
    };

    const configKey = purgeOrg
      ? await computeSurrogateKey(`${org}_config.json`)
      : await computeSurrogateKey(`${site}--${org}_config.json`);
    const purgeKeys = [configKey];
    if (purgeHead) {
      // include head surrogate key
      purgeKeys.push(`${opts.ref}--${opts.repo}--${opts.owner}_head`);
    }
    await purge.sorregate(context, info, purgeKeys, PURGE_CONFIG);

    // purge cloudflare zones for config
    await purgeCloudflareZones(context, info, { keys: purgeKeys }, PURGE_CONFIG);

    // purge preview and live as they cache the condfig as well
    const purgeInfos = keys.map((key) => ({ key }));
    for (const key of purgeKeys) {
      purgeInfos.push({ key });
    }
    return purge.perform(context, info, purgeInfos, PURGE_PREVIEW_AND_LIVE);
  },

  /**
   * Purges the resource. can be either content or code resource
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {Number} scope PURGE_PREVIEW, PURGE_LIVE or PURGE_PREVIEW_AND_LIVE
   * @returns {Promise<Response>} response
   */
  resource: async (context, info, scope = PURGE_LIVE) => {
    const { attributes: { config: { content: { contentBusId } } } } = context;

    const contentPathKey = await computeSurrogateKey(`${contentBusId}${info.webPath}`);
    const codePathKey = await computeSurrogateKey(`${info.ref}--${info.repo}--${info.owner}${info.webPath}`);

    const contentKeyPrefixes = [];
    if (scope & PURGE_LIVE) {
      contentKeyPrefixes.push('');
    }
    if (scope & PURGE_PREVIEW) {
      contentKeyPrefixes.push('p_');
    }

    const prefixKey = (prefixes, key) => prefixes.map((prefix) => ({ key: `${prefix}${key}` }));

    // for metadata json, purge with meta surrogate and the json one
    const metadataPaths = await getMetadataPaths(context, info);
    if (metadataPaths.includes(info.resourcePath)) {
      await purge.config(context, info);
      return purge.perform(context, info, [
        ...prefixKey(contentKeyPrefixes, `${contentBusId}_metadata`),
        ...prefixKey(contentKeyPrefixes, contentPathKey),
      ], scope, info.ref);
    }

    // for the headers and config resource, purge config service and all content
    const configResource = [HEADERS_JSON_PATH, CONFIG_JSON_PATH].includes(info.resourcePath);
    if (configResource) {
      const headersChanged = ({ attributes }) => {
        const { originalConfigAll, configAll } = attributes;
        return !originalConfigAll || JSON.stringify(originalConfigAll.headers) !== JSON.stringify(configAll.headers);
      };

      if (headersChanged(context)) {
        return purge.config(context, {
          ...info,
          keys: [contentBusId, `p_${contentBusId}`],
        });
      }
    }

    // for mapped metadata json, purge with meta and json
    if (info.resourcePath.endsWith(METADATA_JSON_PATH)) {
      const folderKey = await computeSurrogateKey(`${contentBusId}${info.resourcePath.substring(0, info.resourcePath.length - METADATA_JSON_PATH.length)}`);
      return purge.perform(context, info, [
        ...prefixKey(contentKeyPrefixes, `${folderKey}_metadata`),
        ...prefixKey(contentKeyPrefixes, contentPathKey),
      ], scope, info.ref);
    }

    // for head, purge with head surrogate
    if (info.webPath === '/head') {
      return purge.perform(context, info, [{
        key: `${info.ref}--${info.repo}--${info.owner}_head`,
      }], scope, info.ref);
    }

    // for json, try to do a surrogate purge
    if (info.resourcePath.endsWith('.json')) {
      return purge.perform(context, info, [
        ...prefixKey(contentKeyPrefixes, contentPathKey),
        {
          key: codePathKey,
        }, {
          path: info.webPath,
        },
      ], scope, info.ref);
    }

    if (info.rawPath.endsWith('.html')) {
      // purge the raw path. see https://github.com/adobe/helix-admin/issues/1792
      return purge.perform(context, info, [
        ...prefixKey(contentKeyPrefixes, await computeSurrogateKey(`${contentBusId}${info.rawPath}`)),
        {
          path: info.rawPath,
        },
      ], scope, info.ref);
    }

    // otherwise purge with variants
    return purge.perform(context, info, [
      ...getPurgePathVariants(info.webPath).map((path) => ({ path })),
      ...prefixKey(contentKeyPrefixes, contentPathKey),
      {
        key: codePathKey,
      }], scope, info.ref);
  },

  /**
   * Purges the given code-bus paths.
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @param {Array<string>} paths live paths to purge
   * @returns {Promise<Response>} response
   */
  code: async (context, info, paths) => {
    const purgeInfos = [];

    const sites = await querySiblingSites(context, info);
    const rro = `${info.ref}--${info.repo}--${info.owner}`;
    if (paths.length > 10) {
      // if more than 10 paths => purge ALL code with key: <ref>--<repo>--<owner>_code
      purgeInfos.push({
        key: `${rro}_code`,
      });
    } else {
      for (const path of paths) {
        purgeInfos.push({
          // eslint-disable-next-line no-await-in-loop
          key: await computeSurrogateKey(`${rro}${path}`),
        }, {
          path,
        });
      }
    }
    // include special keys for head.html and fstab.yaml
    if (paths.includes('/head.html')) {
      purgeInfos.push({
        key: `${rro}_head`,
      });
    }
    if (paths.includes('/fstab.yaml')) {
      purgeInfos.push({
        key: `${rro}_head`,
      }, {
        key: `${rro}_404`,
      });
    }
    return purge.perform(context, info, purgeInfos, PURGE_PREVIEW_AND_LIVE, info.ref, sites);
  },

  /**
   * Purges the given content-bus paths
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   *
   * @param {Array<string>} paths paths to purge
   * @param {Number} scope PURGE_PREVIEW, PURGE_LIVE or PURGE_PREVIEW_AND_LIVE
   * @returns {Promise<Response>} response
   */
  content: async (context, info, paths, scope = PURGE_LIVE) => {
    const { attributes: { content: { contentBusId } } } = context;
    const contentKeyPrefixes = [];
    if (scope & PURGE_LIVE) {
      contentKeyPrefixes.push('');
    }
    if (scope & PURGE_PREVIEW) {
      contentKeyPrefixes.push('p_');
    }
    const prefixKey = (prefixes, key) => prefixes.map((prefix) => ({ key: `${prefix}${key}` }));
    const purgeInfos = [];
    for (const path of paths) {
      // eslint-disable-next-line no-await-in-loop
      const pathKey = await computeSurrogateKey(`${contentBusId}${path}`);
      purgeInfos.push(
        ...prefixKey(contentKeyPrefixes, pathKey),
        {
          path,
        },
      );
    }
    return purge.perform(context, info, purgeInfos, scope, info.ref);
  },

  /**
   * Purges the given redirect paths
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   *
   * @param {Array<string>} paths live paths to purge
   * @param {Number} scope PURGE_PREVIEW, PURGE_LIVE or PURGE_PREVIEW_AND_LIVE
   * @returns {Promise<Response>} response
   */
  redirects: async (context, info, paths, scope = PURGE_LIVE) => {
    const { attributes: { content: { contentBusId } } } = context;
    const contentKeyPrefixes = [];
    if (scope & PURGE_LIVE) {
      contentKeyPrefixes.push('');
    }
    if (scope & PURGE_PREVIEW) {
      contentKeyPrefixes.push('p_');
    }
    const prefixKey = (prefixes, key) => prefixes.map((prefix) => ({ key: `${prefix}${key}` }));
    // eslint-disable-next-line no-param-reassign
    const purgeInfos = [];
    for (let path of paths) {
      const lastSlash = path.lastIndexOf('/');
      const lastDot = path.lastIndexOf('.');
      const ext = lastDot < 0 ? '' : path.substring(lastDot);
      if (ext === '.md') {
        path = path.substring(0, lastDot);
      }
      if (path.substring(lastSlash) === '/index') {
        path = path.substring(0, lastSlash + 1);
      }
      // eslint-disable-next-line no-await-in-loop
      const pathKey = await computeSurrogateKey(`${contentBusId}${path}`);
      purgeInfos.push(
        ...prefixKey(contentKeyPrefixes, pathKey),
        {
          // we keep path since certain BYO CDN types only support purge by url
          path,
        },
      );
    }

    return purge.perform(context, info, purgeInfos, scope, info.ref);
  },

  /**
   * Special purge function for resources on hlx.page
   * (i.e. /helix-config.json)
   *
   * @param {import('../support/AdminContext').AdminContext} context context
   * @param {import('../support/RequestInfo').RequestInfo} info request info
   * @returns {Promise<Response>}
   */
  hlxPage: async (context, info, paths) => {
    const { log } = context;
    const { org, site, ref } = info;
    const fetch = context.getFetch();

    // purge fastly: hlx.page, hlx-fastly.page

    const { env: { HLX_FASTLY_PURGE_TOKEN: fastlyKey } } = context;
    const hosts = [
      `${ref}--${site}--${org}.hlx.page`,
      `${ref}--${site}--${org}.hlx-fastly.page`,
    ];
    let result = await processQueue(cartesian(hosts, paths), async ([host, path]) => {
      // eslint-disable-next-line no-plusplus
      const id = context.nextRequestId();
      const url = `https://api.fastly.com/purge/${host}${path}`;
      log.info(`[${id}] [fastly] sending url purge to ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'fastly-key': fastlyKey,
        },
      });
      const msg = await res.text();
      if (res.ok) {
        log.info(`[${id}] [fastly] response: ${res.status}: ${msg}`);
      } else {
        const level = logLevelForStatusCode(res.status);
        log[level](`[${id}] [fastly] response: ${res.status}: ${msg}`);
      }
      return res.status;
    }, 32);

    if (result.some((status) => status >= 300)) {
      // sort result status descending (so we get the most serious errors first)
      result.sort((a, b) => b - a);
      return new Response('[fastly] error from helix-purge', {
        status: propagateStatusCode(result[0]),
      });
    }

    // purge cloudflare

    // only purge if the hlx.live hostname resolves to a cloudflare zone
    if (!await resolve.isCloudflareZone(context, `main--${site}--${org}.hlx.live`)) {
      return new Response('', {
        status: 200,
      });
    }

    const {
      CLOUDFLARE_PURGE_TOKEN: token,
      HLX_PAGE_ZONE_ID, // hlx.page
      HLX_CLOUDFLARE_PAGE_ZONE_ID, // hlx-cloudflare.page
    } = context.env;

    /* c8 ignore next 5 */
    if (!token) {
      return new Response('', {
        status: 200,
      });
    }

    // the cloudflare inner cdn uses special cache keys for paths
    const prefixedPaths = paths.map((p) => `${ref}--${site}--${org}${p}`);
    const zoneIds = [];
    if (HLX_PAGE_ZONE_ID) {
      zoneIds.push(HLX_PAGE_ZONE_ID);
    }
    if (HLX_CLOUDFLARE_PAGE_ZONE_ID) {
      zoneIds.push(HLX_CLOUDFLARE_PAGE_ZONE_ID);
    }

    result = await processQueue(zoneIds, async (zoneId) => {
      // eslint-disable-next-line no-plusplus
      const id = context.nextRequestId();
      const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
      const headers = { Authorization: `Bearer ${token}` };
      const method = 'POST';
      const body = { tags: prefixedPaths };

      log.info(`[${id}] [cloudflare] purging ${prefixedPaths} on zone ${zoneId}`);

      const resp = await fetch(url, { method, headers, body });
      const msg = await resp.text();

      if (resp.ok && JSON.parse(msg).success === true) {
        log.info(`[${id}] [cloudflare] purge succeeded: ${msg}`);
      } else {
        const level = logLevelForStatusCode(resp.status);
        log[level](`[${id}] [cloudflare] purge failed: ${resp.status} - ${msg}`);
        log[level](`[${id}] [cloudflare] purge body was: ${JSON.stringify(body, 0, 2)}`);
      }
      return resp.status;
    }, 32);

    if (result.some((status) => status >= 300)) {
      // sort result status descending (so we get the most serious errors first)
      result.sort((a, b) => b - a);
      return new Response('[cloudflare] error from helix-purge', {
        status: propagateStatusCode(result[0]),
      });
    }

    return new Response('', {
      status: 200,
    });
  },
};

export default purge;
