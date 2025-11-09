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
import { promisify } from 'util';
import zlib from 'zlib';
import { Response } from '@adobe/fetch';

const IDENTITY = 'identity';

const ENCODERS = {
  gzip: promisify(zlib.gzip),
  br: promisify(zlib.brotliCompress),
  [IDENTITY]: null,
};

/**
 * Returns the best, supported encoding from the header value
 * eg: `br;q=1.0, gzip;q=0.8, *;q=0.1`
 *
 * @see https://datatracker.ietf.org/doc/html/rfc2616#section-14.3
 *
 *   A server tests whether a content-coding is acceptable, according to
 *    an Accept-Encoding field, using these rules:
 *
 *       1. If the content-coding is one of the content-codings listed in
 *          the Accept-Encoding field, then it is acceptable, unless it is
 *          accompanied by a qvalue of 0. (As defined in section 3.9, a
 *          qvalue of 0 means "not acceptable.")
 *
 *       2. The special "*" symbol in an Accept-Encoding field matches any
 *          available content-coding not explicitly listed in the header
 *          field.
 *
 *       3. If multiple content-codings are acceptable, then the acceptable
 *          content-coding with the highest non-zero qvalue is preferred.
 *
 *       4. The "identity" content-coding is always acceptable, unless
 *          specifically refused because the Accept-Encoding field includes
 *          "identity;q=0", or because the field includes "*;q=0" and does
 *          not explicitly include the "identity" content-coding. If the
 *          Accept-Encoding field-value is empty, then only the "identity"
 *          encoding is acceptable.
 *
 * If no supported encoding can be found, `undefined` is returned.
 *
 * @param {string} value
 * @return {string|undefined} the encoding
 */
export function getEncoding(value) {
  if (!value) {
    return IDENTITY;
  }

  const accepted = {};
  let qDefault;

  // the list of accepted encodings
  value
    .split(',')
    .forEach((v) => {
      let [e, q] = v.split(';q=');
      e = e.trim();
      q = q ? Number.parseFloat(q) : -1;
      if (e === '*') {
        qDefault = q;
      } else if (q !== 0 && e in ENCODERS) {
        accepted[e] = q;
      }
    });
  // if there is a *, add the supported encodings that were not specified
  if (qDefault) {
    Object.keys(ENCODERS).forEach((e) => {
      if (!(e in accepted)) {
        accepted[e] = qDefault;
      }
    });
  }
  // add identity if missing
  if (!(IDENTITY in accepted) && qDefault !== 0) {
    accepted[IDENTITY] = -1;
  }
  // sort the entries by q and e and map them to their names (e) (br < gzip < identity :-)
  const sorted = Object.entries(accepted)
    .sort(([e0, q0], [e1, q1]) => (q0 === q1 ? e0.localeCompare(e1) : q1 - q0))
    .map(([e]) => e);
  return sorted[0];
}

/**
 * Respects the 'accept-encoding' request header and encodes the response with gzip if allowed.
 * @param {Request} request
 * @param {import('@adobe/helix-universal').UniversalContext} context
 * @param {Response} response original response
 * @returns {Promise<Response>} the resulting response
 */
export async function contentEncode(request, context, response) {
  // only handle 200 responses for GET requests
  if (request.method !== 'GET' || (response.status !== 200 && response.status !== 404)) {
    return response;
  }

  // always set vary header
  response.headers.append('vary', 'Accept-Encoding');

  // ignore existing encodings
  if (response.headers.get('content-encoding')) {
    return response;
  }

  // check if request accepts encoding
  const acceptEncoding = getEncoding(request.headers.get('accept-encoding') || '');
  const encoder = ENCODERS[acceptEncoding];
  if (!encoder) {
    return response;
  }

  // create new response with gzipped content
  const body = await response.buffer();
  const zipped = await encoder(body);
  response.headers.set('content-encoding', acceptEncoding);
  return new Response(zipped, response);
}

/**
 * Wrapper to apply content encoding
 * @param {UniversalAction} fn
 * @returns {function(Request, UniversalContext): Promise<Response>}
 */
export function contentEncodeWrapper(fn) {
  return async (req, context) => {
    const resp = await fn(req, context);
    return contentEncode(req, context, resp);
  };
}
