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
 * @returns {Promise<{ sidekick: object }>}
 */
export async function getConfigJsonResponse(context, info) {
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

  return { sidekick };
}
