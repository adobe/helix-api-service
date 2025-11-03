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
import { cleanupHeaderValue } from '@adobe/helix-shared-utils';
import SitemapBuilder from './builder.js';
import { fetchExtendedSitemap, INTERNAL_SITEMAP } from './utils.js';
// import { getNotifier } from '../support/notifications.js';
import { errorResponse } from '../support/utils.js';
// import { audit } from '../support/audit.js';

/**
 * Check whether a sitemap's source matches a given string.
 *
 * @param {any} sitemap sitemap
 * @param {string} s string to match
 * @returns {boolean} true if it matches, else false
 */
function matchSource(sitemap, s) {
  const { source } = sitemap;
  if (!source) {
    return false; // has no source
  }
  if (source.endsWith('.xml')) {
    return false; // is external
  }
  // source is internal, strip eventual query string
  return source.split('?')[0] === s;
}

/**
 * Rebuild a sitemap given its destination, e.g. `/sitemap.xml`
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} opts options
 * @returns {Promise<Response>} response
 */
export async function rebuildSitemap(context, info, opts = {}) {
  const { log } = context;
  const {
    org, site, webPath: destination,
  } = info;
  const { updatePreview = false, fetchTimeout = 5000 } = opts;

  let sitemapConfig;
  try {
    sitemapConfig = await fetchExtendedSitemap(context, info);
    if (!sitemapConfig) {
      return errorResponse(log, 404, `No sitemap configuration found for: ${org}/${site}`);
    }
  } catch (e) {
    const msg = `Error fetching sitemap configuration: ${e.message}`;
    if (e.status) {
      return errorResponse(log, e.status, msg);
    } else {
      // no status indicates the sitemap config is invalid
      return new Response('', {
        status: 400,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store, private, must-revalidate',
          'x-error': cleanupHeaderValue(msg),
        },
      });
    }
  }

  const { sitemaps } = sitemapConfig;
  let config;

  const match = (sitemap) => sitemap.destination === destination;

  config = sitemaps.find((s) => match(s));
  if (!config) {
    config = sitemaps.find((s) => s.languages && Object.values(s.languages).find((l) => match(l)));
  }
  if (!config) {
    const msg = `Unable to find sitemap that has destination: ${destination}`;
    log.info(msg);
    return new Response('', {
      status: 204,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store, private, must-revalidate',
        'x-error': cleanupHeaderValue(msg),
      },
    });
  }
  if (config.name === INTERNAL_SITEMAP) {
    // TODO
    // await getNotifier(ctx).publish('sitemap-updated', info, {
    //   status: 200,
    //   resourcePath: config.destination,
    // });
    // await audit(ctx, info, {
    //   start: Date.now(),
    //   properties: {
    //     source: 'sitemap',
    //     updated: [config.destination],
    //   },
    // });

    // we don't need to build the sitemap ourselves (pipeline will),
    // simply return the destination path that needs to be purged
    return new Response(JSON.stringify({ paths: [config.destination] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  // gather prerequisites and create builder
  const { attributes: { config: { cdn } } } = context;
  const host = cdn?.prod?.host;

  const builder = new SitemapBuilder({
    config, origin: `https://${host}`,
  });

  try {
    await builder.build(context, fetchTimeout);
    const result = await builder.store(context, updatePreview);

    log.info(`Sitemap for ${config.name} rebuilt: ${result.paths}.`);
    // TODO
    // await getNotifier(ctx).publish('sitemap-updated', info, {
    //   status: 200,
    //   resourcePaths: result.paths,
    // });
    // await audit(ctx, info, {
    //   start: Date.now(),
    //   properties: {
    //     source: 'sitemap',
    //     updated: [result.paths],
    //   },
    // });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  } catch (e) {
    return errorResponse(log, e.statusCode || 500, e.message);
  }
}

/**
 * Rebuild sitemap definition if it changed due to some change in `source`.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {object} config sitemap configuration
 * @param {String} source query index that changed
 * @param {String} origin default origin to use
 * @param {Number} fetchTimeout fetch timeout for external sitemaps
 * @param {Boolean} updatePreview flag indicating whether to also update preview partition
 * @returns {Promise<Response>} response
 */
async function rebuildIfChanged(
  context,
  config,
  source,
  origin,
  fetchTimeout,
  updatePreview,
) {
  if (config.name === INTERNAL_SITEMAP) {
    // we don't need to build the sitemap ourselves (pipeline will),
    // simply return the destination path that needs to be purged
    return new Response(JSON.stringify({ paths: [config.destination] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }
  const { log } = context;
  const builder = new SitemapBuilder({
    config, origin,
  });

  try {
    if (!await builder.changed(context, source, fetchTimeout)) {
      const msg = `Sitemap for ${config.name} did not change, no update needed.`;
      log.info(msg);
      return new Response('', {
        status: 204,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store, private, must-revalidate',
          'x-error': cleanupHeaderValue(msg),
        },
      });
    }
    await builder.build(context, fetchTimeout);
    const result = await builder.store(context, updatePreview);

    log.info(`Sitemap for ${config.name} rebuilt: ${result.paths}.`);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  } catch (e) {
    return errorResponse(log, e.statusCode || 500, e.message);
  }
}

/**
 * Checks whether a change to some sitemap source also changed the sitemap and it therefore
 * needs to be rebuilt.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {object} opts options
 * @returns {Promise<Response>} response
 */
export async function sourceChanged(context, info, opts = {}) {
  const { log } = context;
  const { org, site } = info;
  const { source, fetchTimeout = 5000, updatePreview = false } = opts;

  let sitemapConfig;
  try {
    sitemapConfig = await fetchExtendedSitemap(context, info);
    if (!sitemapConfig) {
      return errorResponse(log, 404, `No sitemap configuration found for: ${org}/${site}`);
    }
  } catch (e) {
    const msg = `Error fetching sitemap configuration: ${e.message}`;
    if (e.status) {
      return errorResponse(log, e.status, msg);
    } else {
      // no status indicates the sitemap config is invalid
      return new Response('', {
        status: 400,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store, private, must-revalidate',
          'x-error': cleanupHeaderValue(msg),
        },
      });
    }
  }

  const { sitemaps } = sitemapConfig;

  const match = (sitemap) => matchSource(sitemap, source);
  const configs = sitemaps.filter(
    (
      /* simple sitemap matches the source */
      s,
    ) => match(s)
    || (
      /* multi-language sitemap has a language that matches the source */
      s.languages && Object.values(s.languages).find((l) => match(l))
    ),
  );
  if (!configs.length) {
    const msg = `Unable to find any sitemap that has source: ${source}`;
    log.info(msg);
    return new Response('', {
      status: 204,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store, private, must-revalidate',
        'x-error': cleanupHeaderValue(msg),
      },
    });
  }

  // gather prerequisites and create builder
  const { attributes: { config: { cdn } } } = context;
  const host = cdn?.prod?.host;

  const responses = await Promise.all(configs.map(
    async (config) => rebuildIfChanged(context, config, source, `https://${host}`, fetchTimeout, updatePreview),
  ));

  const paths = [];
  for (const response of responses) {
    if (response.status === 200) {
      // eslint-disable-next-line no-await-in-loop
      const json = await response.json();
      paths.push(...json.paths);
    }
  }
  if (paths.length === 0) {
    // if no paths were processed, we only have error responses, so return the first
    return responses[0];
  }
  // TODO
  // await getNotifier(ctx).publish('sitemap-updated', info, {
  //   status: 200,
  //   resourcePaths: paths,
  // });
  // await audit(ctx, info, {
  //   start: Date.now(),
  //   properties: {
  //     source: 'sitemap',
  //     updated: [paths],
  //   },
  // });
  return new Response(JSON.stringify({ paths }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
