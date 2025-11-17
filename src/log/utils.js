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

export function decode(nextToken) {
  try {
    if (nextToken) {
      return JSON.parse(Buffer.from(nextToken, 'base64'));
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

export function encode(next) {
  return Buffer.from(JSON.stringify(next)).toString('base64');
}

export function parseIntWithCond(s, cond, defaultValue) {
  if (s) {
    const value = Number.parseInt(s, 10);
    if (!Number.isNaN(value) && cond(value)) {
      return value;
    }
  }
  return defaultValue;
}

export function getNextLinkUrl(info, query) {
  return info.getLinkUrl(info.suffix, Object.entries(query).reduce((o, [k, v]) => {
    if (v) {
      // eslint-disable-next-line no-param-reassign
      o[k] = v;
    }
    return o;
  }, {}));
}

const UNITS = {
  s: (v) => v,
  m: (v) => v * 60,
  h: (v) => v * 3600,
  d: (v) => v * 3600 * 24,
};

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export function parseTimespan(fromS, toS, sinceS) {
  const now = Date.now();

  if (sinceS) {
    if (fromS || toS) {
      throw new Error('\'since\' should not be used with either \'from\' or \'to\'');
    }
    const match = /^(?<duration>[0-9]+)(?<unit>s|m|h|d)$/.exec(sinceS);
    if (!match) {
      throw new Error(`'since' should match a number followed by 's(econds)', 'm(inutes)', 'h(ours)' or 'd(ays)': ${sinceS}`);
    }
    const { duration, unit } = match.groups;
    const sinceMs = UNITS[unit](Number.parseInt(duration, 10)) * 1000;
    return [now - sinceMs, now];
  }

  let from;
  if (!fromS) {
    from = now - FIFTEEN_MINUTES_MS;
  } else {
    from = Date.parse(fromS);
    if (!from) {
      throw new Error(`'from' is not a valid date: ${fromS}`);
    }
  }
  let to;
  if (!toS) {
    to = now;
  } else {
    to = Date.parse(toS);
    if (!to) {
      throw new Error(`'to' is not a valid date: ${toS}`);
    }
  }
  if (from >= to) {
    throw new Error(`'from' (${fromS || new Date(from).toISOString()}) should be smaller than 'to' (${toS || new Date(to).toISOString()})`);
  }
  return [from, to];
}
