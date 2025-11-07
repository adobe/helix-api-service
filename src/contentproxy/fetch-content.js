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
import { InvocationType, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { errorResponse } from '../support/utils.js';
import { error } from './errors.js';

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
 * Creates a response from the result obtained.
 *
 * @param {import('../support/AdminContext').AdminContext} context context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @param {import('./fetch-content.js').FetchContentOptions} opts content options
 * @param {Object} result a result containing statusCode, headers and body
 * @returns {Promise<Response>} payload payload to use in the invoke
 */
function createResponse(context, info, opts, result) {
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
    const responseBody = result.isBase64Encoded ? Buffer.from(body, 'base64') : body;
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
