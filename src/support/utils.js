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

/**
 * From a JSON response, retrieves the `data` sheet if this is a single sheet,
 * or it returns the first existing sheet given by a list of names, if it is a
 * multisheet.
 * Returns `null` if there is neither.
 *
 * @param {any} json JSON object
 * @param {String[]} names names to check in a multi sheet
 */
export function getSheetData(json, names) {
  if (Array.isArray(json.data)) {
    return json.data;
  }
  let sheet;

  const match = names.find((name) => !!json[name]);
  if (match) {
    sheet = json[match];
  }
  if (Array.isArray(sheet?.data)) {
    return sheet.data;
  }
  return null;
}
