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
import { gunzip } from 'zlib';
import { Response } from '@adobe/fetch';
import { InvocationType, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';

const gunzipAsync = promisify(gunzip);

/**
 * Creates the request payload.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('./fetch-content.js').FetchContentOptions} opts content options
 * @returns {Promise<object>} payload payload to use in the invoke command
 */
async function requestPayload(context, info, opts) {
  const { contentBusId } = context;
  const { org, site, ref } = info;
  const { providerParams, providerHeaders, usePost } = opts;

  const { media: mediaBucket } = context.attributes.bucketMap;

  const merged = {
    owner: org, // TODO: remove after sources migrated
    repo: site, // TODO: remove after sources migrated
    org,
    site,
    ref,
    contentBusId,
    mediaBucket,
    rid: context.requestId,
    ...providerParams,
  };
  const headers = {};
  if (opts?.lastModified) {
    headers['if-modified-since'] = opts.lastModified;
  }
  if (providerHeaders) {
    Object.entries(providerHeaders).forEach(([key, value]) => {
      headers[key] = value;
    });
  }

  if (usePost) {
    headers['content-type'] = 'application/json';
    return {
      headers,
      requestContext: {
        http: {
          method: 'POST',
        },
      },
      body: JSON.stringify(merged),
      isBase64Encoded: false,
    };
  } else {
    const params = new URLSearchParams();
    Object.entries(merged).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value);
      }
    });
    return {
      headers,
      requestContext: {
        http: {
          method: 'GET',
        },
      },
      rawQueryString: params.toString(),
    };
  }
}

/**
 * Parses JSON response from conversion services.
 * Returns the parsed object or null if not JSON or parse fails.
 * @param {Buffer|string} responseBody the response body (already decompressed)
 * @param {string} contentType the content-type header
 * @param {object} log logger instance
 * @returns {{markdown: string, media: Array}|null} parsed response or null
 */
function parseJsonResponse(responseBody, contentType, log) {
  if (!contentType?.includes('application/json')) {
    return null;
  }

  try {
    return JSON.parse(responseBody);
  } catch (e) {
    log.warn(`Failed to parse JSON response: ${e.message}`);
    return null;
  }
}

/**
 * Creates a response from the result obtained.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('./fetch-content.js').FetchContentOptions} opts content options
 * @param {Object} result a result containing statusCode, headers and body
 * @returns {Promise<Response>} payload payload to use in the invoke
 */
async function createResponse(context, info, opts, result) {
  const { log } = context;
  const { resourcePath } = info;
  const { provider } = opts;
  const { statusCode, headers: resheaders, body } = result;

  log.info(resheaders);

  const sourceLocation = provider.sourceLocationMapping(resheaders['x-source-location']);
  const headers = {
    'x-source-location': sourceLocation,
  };
  if (resheaders['last-modified']) {
    headers['last-modified'] = resheaders['last-modified'];
  }
  if (resheaders['content-length'] && sourceLocation.startsWith('markup:')) {
    headers['content-length'] = resheaders['content-length'];
  }
  if (resheaders['content-encoding']) {
    headers['content-encoding'] = resheaders['content-encoding'];
  }

  if (statusCode === 304) {
    // not modified
    return new Response('Not modified', {
      status: 304,
      headers,
    });
  }
  if (statusCode < 300) {
    let responseBody = result.isBase64Encoded
      ? Buffer.from(body, 'base64')
      : Buffer.from(body);
    if (resheaders['content-encoding']?.includes('gzip')) {
      responseBody = await gunzipAsync(responseBody);
      delete headers['content-encoding'];
    }

    // Handle JSON responses from conversion services (contains markdown and media)
    const parsed = parseJsonResponse(responseBody, resheaders['content-type'], log);
    if (parsed) {
      // TODO
      // Record uploaded media for logging at end of request
      // if (parsed.media?.length > 0) {
      //   recordMediaUploads(ctx, parsed.media, resourcePath);
      // }
      // Return just the markdown (or empty string if missing)
      responseBody = parsed.markdown || '';
    }

    // Always calculate content-length from actual response body
    headers['content-length'] = Buffer.isBuffer(responseBody)
      ? responseBody.length
      : Buffer.byteLength(responseBody);

    return new Response(responseBody, {
      status: 200,
      headers: {
        'content-type': resheaders['content-type'],
        ...headers,
      },
    });
  }
  const message = resheaders['x-error'] || String(statusCode);
  for (const name of ['retry-after', 'x-severity']) {
    if (resheaders[name]) {
      headers[name] = resheaders[name];
    }
  }
  if (statusCode === 429) {
    headers['x-severity'] = 'warn';
  }
  if (statusCode === 409 && /Images? .* exceeds? allowed limit of .*/.test(message)) {
    return errorResponse(log, -statusCode, error(
      'Unable to preview \'$1\': source contains large image: $2',
      resourcePath,
      message,
    ), { headers });
  }
  return errorResponse(log, -statusCode, error(
    'Unable to fetch \'$1\' from \'$2\': $3',
    resourcePath,
    `${provider.name}`,
    `(${statusCode}) - ${message}`,
  ), { headers });
}

/**
 * Fetches content from a source provider (word2md, gdocs2md, data-embed)
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('./fetch-content.js').FetchContentOptions} opts content options
 * @returns {Promise<Response>} response
 */
export default async function fetchContent(context, info, opts) {
  const { log, attributes, runtime: { region } } = context;
  const { org, site, resourcePath } = info;
  const { provider } = opts;

  const clientConfig = { region };
  if (attributes.maxAttempts) {
    clientConfig.maxAttempts = attributes.maxAttempts;
  }
  const client = new LambdaClient(clientConfig);
  const version = provider.version || provider.defaultVersion;
  const FunctionName = `${provider.package}--${provider.name}:${version}`;

  try {
    log.info(`fetching content for ${org}/${site}${resourcePath} from ${FunctionName}...`);
    const payload = await requestPayload(context, info, opts);
    const output = await client.send(
      new InvokeCommand({
        FunctionName,
        InvocationType: InvocationType.RequestResponse,
        Payload: JSON.stringify(payload),
      }),
    );
    const result = new TextDecoder('utf8').decode(output.Payload);
    if (output.FunctionError) {
      return errorResponse(log, 502, error(
        'Unable to fetch \'$1\' from \'$2\': $3',
        resourcePath,
        `${provider.name}`,
        result,
      ));
    }
    return createResponse(context, info, opts, JSON.parse(result));
  } catch (e) {
    let { message } = e;
    if (e.name === 'ResourceNotFoundException') {
      log.warn(`Unable to invoke handler function: ${message}`);
      // do not provide details about AWS environment
      message = 'function not found';
    }
    return errorResponse(log, provider.version ? 404 : 502, error(
      'Unable to fetch \'$1\' from \'$2\': $3',
      resourcePath,
      `${provider.name}`,
      message,
    ));
  /* c8 ignore next 3 */
  } finally {
    client.destroy();
  }
}
