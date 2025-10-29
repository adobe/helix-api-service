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

const DA_ORIGINS = ['https://content.da.live', 'https://stage-content.da.live'];
const AEMCS_ORIGIN = /^https:\/\/author-p\d+-e\d+(-cmstg)?\.adobeaemcloud\.com$/;
const JSON2HTML_ORIGIN = 'https://json2html.adobeaem.workers.dev';

export function isDAMountpoint(source) {
  return source?.url && DA_ORIGINS.includes(new URL(source.url).origin);
}

export function isAEMCSMountpoint(source) {
  return source?.url && new URL(source.url).origin.match(AEMCS_ORIGIN);
}

export function isJSON2HTMLOrigin(source) {
  return source?.url && new URL(source.url).origin === JSON2HTML_ORIGIN;
}

export function isAdobeMountpoint(source) {
  return isDAMountpoint(source) || isAEMCSMountpoint(source) || isJSON2HTMLOrigin(source);
}
