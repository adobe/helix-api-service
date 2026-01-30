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
import { Job } from './job.js';
import { sleep } from '../support/utils.js';

/**
 * Test job for testing the queue. can only be used with the `job:test` permission only granted to
 * the admin role.
 *
 * @param {AdminContext} ctx context
 * @param {PathInfo} info path info
 * @returns {Promise<Response>} response
 */
export class TestJob extends Job {
  /**
   * runs the test job. currently
   * @return {Promise<void>}
   */
  async run() {
    await this.setPhase('processing');
    const { ctx } = this;
    const { time = 5000, fail } = this.state.data;
    const { log } = ctx;

    log.info(`processing test job for ${time} ms`);
    const endTime = Date.now() + time;
    // eslint-disable-next-line no-await-in-loop
    while (Date.now() < endTime && !await this.checkStopped()) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000);
      /* c8 ignore next 3 */
      if (fail) {
        throw new Error('job failed');
      }
    }
    await this.setPhase('completed');
  }
}
