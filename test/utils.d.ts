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
import nock from "nock";

declare function nocker(
  basePath: string | RegExp | URL,
  options?: nock.Options,
): nock.Scope

declare interface S3Nock {
  head(key: string): nock.Scope;
  deleteObject(key: string): nock.Scope;
  getObject(key: string): nock.Scope;
  putObject(key: string): nock.Scope;
  copyObject(key: string): nock.Scope;
}

declare interface GoogleNock {
  user(cacheData?: any): GoogleNock
  folders(files: string[], id?: string): GoogleNock
  documents(files: string[], id?: string): GoogleNock
  sheets(files: string[], id?: string): GoogleNock
  files(files: string[], id?: string): GoogleNock
  file(id: string, file: any): GoogleNock
}

declare interface OneDriveNock {
  user(): OneDriveNock
  resolveTenant(tenant?: string, tenantId?: string): OneDriveNock;
  login(auth?: any, tenant?: string, tenantId?: string): OneDriveNock
  resolve(path: string, opts: any): OneDriveNock
  getSiteItem(site: string, itemId: string, opts?: any): OneDriveNock
  getFile(path: string, item?: any): OneDriveNock
  getDocument(path: string, item?: any): OneDriveNock
  getWorkbook(path: string, item?: any): OneDriveNock
  getFolder(path: string, item?: any): OneDriveNock
  getChildren(items: any[]): OneDriveNock
}

declare interface Nock {
  google(source: any): GoogleNock
  onedrive(source: any): OneDriveNock
  code(ref?: string): S3Nock;
  content(contentBusId?: string): S3Nock;
  media(contentBusId?: string): S3Nock;
  source(): S3Nock;
  sqs(queueName: string, entries?: any[]): nock.Scope;
}

type NockEnv = Nock & typeof nocker;
