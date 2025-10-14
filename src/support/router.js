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
/* eslint-disable max-classes-per-file */

import { Response } from '@adobe/fetch';

class Node {
  #label;

  #children;

  #handler;

  constructor(label, handler) {
    this.#label = label;
    this.#children = [];
    this.#handler = handler;
  }

  #getOrCreateChild(seg) {
    let ret = this.#children.find((child) => child.#label === seg);
    if (!ret) {
      ret = new Node(seg);
      this.#children.push(ret);
    }
    return ret;
  }

  add(segs, handler) {
    if (segs.length === 0) {
      this.#handler = handler;
    } else {
      const seg = segs.shift();
      this.#getOrCreateChild(seg).add(segs, handler);
    }
  }

  get handler() {
    return this.#handler;
  }

  match(seg, variables) {
    let next = this.#children.find((child) => child.#label === seg);
    if (!next) {
      next = this.#children.find((child) => child.#label.startsWith(':'));
      if (next) {
        const key = next.#label.substring(1);
        // eslint-disable-next-line no-param-reassign
        variables[key] = seg;
      }
    }
    return next;
  }
}

/**
 * Router that will match an incoming request to a handler.
 */
export default class Router {
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
   * Find handler that should handle a request.
   *
   * @param {import('@adobe/fetch').Request} request request
   * @param {import('@adobe/helix-universal').UniversalContext} context context
   * @returns {Function|null} handler or null
   */
  handle(request, context) {
    const { pathInfo: { suffix } } = context;
    const segs = suffix.split('/').slice(1);
    const variables = {};

    let current = this.#root;

    for (const seg of segs) {
      const child = current.match(seg, variables);
      if (!child) {
        break;
      }
      current = child;
    }
    const { handler } = current;
    if (handler) {
      return handler(request, context);
    }
    return new Response('', { status: 404 });
  }
}
