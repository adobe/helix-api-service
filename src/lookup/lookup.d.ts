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
import { AdminContext } from '../support/AdminContext.js';
import { RequestInfo } from '../support/RequestInfo.js';

declare interface MountConfig {}
declare interface MountPoint {}

declare interface LookupOptions {
  mp:MountPoint;
}

declare interface ReverseLookupOptions {
  owner:string;
  repo:string;
  ref:string;
  path:string;
  editUrl:string;
}

declare interface DetailedReverseLookupOptions {
  mount:MountConfig,
}

declare interface EditFolderInfo {
  name: string,
  url: string,
  path: string,
}

declare interface LookupResponse {
  /**
   * http like status of the lookup request
   */
  status: number,

  /**
   * Error reason in case lookup failed.
   */
  error?: string,

  /**
   * The path of the web resource. eg /en/blogs/blog-42
   */
  path: string,

  /**
   * The path of the resource. eg /en/blogs/blog-42.md
   */
  resourcePath: string,

  /**
   * The edit URL of the source document, e.g. a sharepoint link
   */
  editUrl: string,

  /**
   * The last modified date of the source document.
   */
  sourceLastModified?: string,

  /**
   * Source provider internal location of the document (e.g. drive id)
   */
  sourceLocation?: string,

  /**
   * Name of the document.
   */
  editName?: string,

  /**
   * Array of edit folders that specify the hierarchy path to the document.
   */
  editFolders?: EditFolderInfo[],
}

declare type Lookup = (context: AdminContext, info: RequestInfo) => Promise<Response>;

declare interface LookupHandler {
  name: string;
  lookup: Lookup,
}
