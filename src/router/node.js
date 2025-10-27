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
 * Node in the router tree, either intermediate or leaf.
 */
export class Node {
  /**
   * Label for this node.
   */
  #label;

  /**
   * Literal hildren of this node.
   */
  #children;

  /**
   * Star node (e.g. `/*`)
   */
  #star;

  /**
   * Variable node (e.g. `/:org`)
   */
  #variable;

  /**
   * Handler, null for intermediate leafs.
   */
  #handler;

  constructor(label, handler) {
    this.#label = label;
    this.#children = [];
    this.#handler = handler;
  }

  #getOrCreateChild(seg) {
    if (seg === '*') {
      if (!this.#star) {
        this.#star = new Node(seg);
      }
      return this.#star;
    }
    if (seg.startsWith(':')) {
      if (!this.#variable) {
        this.#variable = new Node(seg.substring(1));
      }
      return this.#variable;
    }
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

  get label() {
    return this.#label;
  }

  /**
   * Matches a path by traversing a tree of nodes.
   *
   * @param {string[]} segs path segments to match
   * @param {Map} variables variables extracted while matching
   * @returns {Node} matching node or null
   */
  match(segs, variables) {
    if (segs.length === 0) {
      variables.set('route', this.label);
      return this;
    }
    const seg = segs.shift();

    // find exact match
    const next = this.#children.find((child) => child.#label === seg);
    if (next) {
      return next.match(segs, variables);
    }

    // use variable extracting match (e.g. ':org')
    if (this.#variable) {
      const key = this.#variable.#label;
      variables.set(key, seg);
      return this.#variable.match(segs, variables);
    }

    // use trailing '*' match
    if (this.#star) {
      segs.unshift(seg);
      variables.set('path', `/${segs.join('/')}`);
      variables.set('route', this.label);
      return this.#star;
    }
    return null;
  }
}
