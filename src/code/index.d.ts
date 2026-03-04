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

import {Octokit} from "@octokit/rest";

/**
 * change type
 */
declare enum ChangeType {
  added = 'added',
  deleted = 'deleted',
  modified = 'modified',
}

/**
 * A change event sent from helix-bot
 */
declare interface Change {
  /**
   * type of change
   */
  type: ChangeType,

  /**
   * Relative path of changed resource or `*` if this as a branch event.
   */
  path: string,

  /**
   * timestamp of change
   */
  time: number,

  /**
   * Last modified (header)
   */
  lastModified?: string,

  /**
   * commit sha of change
   */
  commit?: string,

  /**
   * if {@code true}, cached data in change is not deleted
   */
  retainData?: boolean,

  /**
   * data that is retained for post processing
   */
  data?: Buffer,

  /**
   * Length of content
   */
  contentLength?: number,

  /**
   * Content type of data
   */
  contentType?: string,
}

declare interface ProcessedChange extends Change {
  /**
   * Data of file.
   */
  data?: Buffer,
}

export declare interface ChangeEvent {
  /**
   * event type source
   * @default 'github'
   */
  type: string,

  /**
   * github app installation id
   */
  installationId: string,

  /**
   * repository owner (github)
   */
  owner: string,

  /**
   * repository owner (code bus)
   */
  codeOwner: string,

  /**
   * repository name
   */
  repo: string,

  /**
   * repository repo (code bus)
   */
  codeRepo: string,

  /**
   * repository ref
   */
  ref: string,

  /**
   * repository ref (code bus)
   */
  codeRef: string,

  /**
   * code bus prefix
   */
  codePrefix: string,

  /**
   * repository ref
   */
  branch: string,

  /**
   * base ref for branch operations
   */
  baseRef?: string,

  /**
   * array of changes
   * @type Change
   */
  changes: Change[],
}

declare interface LiveInfo {
  url: string,
}

declare interface CodeInfo {
  codeBusId: string,
  lastModified: string,
  contentType: string,
  contentLength: number,
}

declare interface CodeResponse {
  code: CodeInfo,
  live: LiveInfo,
}

declare interface CodeSource {
  owner: string,
  repo: string,
  installationId: string,
  base_url: string,
  raw_url: string,
  token: string,
  octokit: Octokit,
}
