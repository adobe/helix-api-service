/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Wrapper to add common Response headers
 * @param {UniversalFunction}
 * @returns {function(Request, UniversalContext): Promise<Response>}
 */
export default function commonResponseHeaders(fn) {
  return async (request, context) => {
    const response = await fn(request, context);
    if (!response.headers.has('cache-control')) {
      response.headers.set('cache-control', 'no-store, private, must-revalidate');
    }

    // add CORS headers if origin is present
    const origin = request.headers.get('origin');
    if (origin) {
      // echo the requested origin back to the client. You may like to
      // check this against a whitelist of origins instead of blindly
      // allowing potentially destructive requests from any origin
      response.headers.set('access-control-allow-origin', origin);

      // The Access-Control-Allow-Credentials response header tells browsers whether
      // to expose the response to the frontend JavaScript code when the request's
      // credentials mode (Request.credentials) is include.
      response.headers.set('access-control-allow-credentials', 'true');

      // The Access-Control-Expose-Headers response header allows a server to
      // indicate which response headers should be made available to scripts
      // running in the browser, in response to a cross-origin request.
      const existing = response.headers.get('access-control-expose-headers');
      response.headers.set(
        'access-control-expose-headers',
        existing ? `${existing}, x-error, x-error-code` : 'x-error, x-error-code',
      );
    }
    return response;
  };
}
