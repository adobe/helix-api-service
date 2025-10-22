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
   * Children of this node.
   */
  #children;

  /**
   * Handler, null for intermediate leafs.
   */
  #handler;

  constructor(label, handler) {
    this.#label = label;
    this.#children = [];
    this.#handler = handler;
  }

  #getOrCreateChild(seg, handler) {
    let ret = this.#children.find((child) => child.#label === seg);
    if (!ret) {
      ret = new Node(seg, handler);
      this.#children.push(ret);
    }
    return ret;
  }

  add(segs, handler) {
    if (segs.length === 0) {
      this.#handler = handler;
    } else {
      const seg = segs.shift();
      if (seg !== '*') {
        this.#getOrCreateChild(seg).add(segs, handler);
      } else {
        this.#getOrCreateChild(seg, handler);
      }
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
    let next = this.#children.find((child) => child.#label === seg);
    if (next) {
      return next.match(segs, variables);
    }

    // find first variable extracting match (e.g. ':org')
    next = this.#children.find((child) => child.#label.startsWith(':'));
    if (next) {
      const key = next.#label.substring(1);
      variables.set(key, seg);
      return next.match(segs, variables);
    }

    // find trailing '*' match
    next = this.#children.find((child) => child.#label === '*');
    if (next) {
      segs.unshift(seg);
      variables.set('path', `/${segs.join('/')}`);
      variables.set('route', this.label);
      return next;
    }
    return null;
  }
}
