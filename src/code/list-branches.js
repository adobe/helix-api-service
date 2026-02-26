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
import { Response } from '@adobe/fetch';
import { HelixStorage } from '@adobe/helix-shared-storage';

/**
 * lists the branches of the repository present in code bus (not github)
 * @param {AdminContext} ctx context
 * @param {PathInfo} info path info
 * @returns {Promise<Response>} response
 */
export async function listBranches(ctx, info) {
  ctx.attributes.authInfo.assertPermissions('code:read');
  const { org, site } = info;
  const codeBus = HelixStorage.fromContext(ctx).codeBus();
  const branches = await codeBus.listFolders(`${org}/${site}/`);
  const resp = {
    owner: org,
    repo: site,
    branches: branches
      .filter((branch) => !branch.endsWith('.helix/'))
      .map((branch) => {
        const [owner, repo, name] = branch.split('/');
        return `/${owner}/repos/${repo}/code/${name}`;
      }),
  };

  return new Response(JSON.stringify(resp, null, 2), {
    headers: {
      'content-type': 'application/json',
    },
  });
}
