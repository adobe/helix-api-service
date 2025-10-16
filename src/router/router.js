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
import { Response } from '@adobe/fetch';
import { Node } from './node.js';

/**
 * Router that will match an incoming request to a handler.
 */
export default class Router {
  /**
   * Root node.
   */
  #root;

  constructor() {
    this.#root = new Node('/');
  }

  /**
   * Add a new handler for a given expression.
   *
   * @param {string} expr expression
   * @param {function} handler handler
   */
  add(expr, handler) {
    const segs = expr.split('/').slice(1);

    this.#root.add(segs, handler);

    return this;
  }

  /**
   * Find and execute handler that should handle a request. If none is found
   * we return a 404 response.
   *
   * @param {import('@adobe/fetch').Request} request request
   * @param {import('@adobe/helix-universal').UniversalContext} context context
   * @returns {Response} response
   */
  handle(request, context) {
    const { suffix } = context;
    const segs = suffix.split('/').slice(1);

    const variables = {};
    const match = this.#root.match(segs, variables);

    const { handler, label } = match ?? {};
    if (handler) {
      variables.route = label;
      return handler(request, context, variables);
    }
    return new Response('', { status: 404 });
  }
}
