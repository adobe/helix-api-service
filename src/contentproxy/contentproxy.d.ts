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

declare interface ContentOptions {}

declare interface SourceInfo {
  name:string;
  location:string,
  contentType:string;
  lastModified:number;
  size:number;
  type:string;
}

declare interface ResourceInfo {
  path:string;
  resourcePath:string;
  source:SourceInfo;
}

declare type Predicate = (source: object) => boolean;

declare type FetchContent = (context: AdminContext, info: RequestInfo) => Promise<Response>;

declare interface ProgressInfo {
  total:number;
  processed: number;
  failed: number;
}

/**
 * inform the user of progress and stop processing if callback returns `false`
 */
declare type ProgressCallback = (progress:ProgressInfo) => Promise<boolean>;

/**
 * Returns the list of resource below the `paths`. If a path ends with `/*` it is recursively
 * enumerated.
 *
 * Note that the contents of the `/.helix` folder are never returned.
 */
declare type FetchList = (context: AdminContext, info: RequestInfo, paths: Array<string>, progressCB: ProgressCallback) => Promise<Array<ResourceInfo>>;

declare interface ContentSourceHandler {
  name: string;
  test: Predicate;
  handle: FetchContent,
  handleJSON: FetchContent,
  handleFile: FetchContent,
  list: FetchList,
}
