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
import { Job } from './job.js';
import { TestJob } from './test-job.js';
import { JobStorage } from './storage.js';
import { CodeJob } from '../code/code-job.js';

const ALLOWED_METHODS = ['GET', 'DELETE', 'RUN', 'POST'];

export const JOB_CLASS = {
  test: TestJob,
  code: CodeJob,
};

/**
 * Handles the /job route
 * @param {AdminContext} ctx the universal context
 * @param {import('../support/RequestInfo').RequestInfo} info request info
 * @returns {Promise<Response>} response
 */
export default async function jobHandler(ctx, info) {
  const { log, attributes: { authInfo } } = ctx;

  if (ALLOWED_METHODS.indexOf(info.method) < 0) {
    return new Response('method not allowed', {
      status: 405,
    });
  }

  authInfo.assertPermissions('job:read');

  const { topic } = info.variables;
  const [, jobName, report] = info.variables.path?.split('/') ?? [];

  // create test job
  if (info.method === 'POST') {
    if (topic !== 'test') {
      return new Response('method not allowed', {
        status: 405,
      });
    }
    authInfo.assertPermissions('job:test');
    return Job.create(ctx, info, 'test', {
      jobClass: JOB_CLASS.test,
      data: {
        fail: ctx.data.fail,
        time: ctx.data.time,
      },
      roles: ['author'],
      noAudit: true,
    });
  }

  const JobClass = JOB_CLASS[topic];
  if (!JobClass) {
    log.error('no such job topic', topic);
    return new Response('', {
      status: 404,
    });
  }

  const storage = await JobStorage.create(ctx, info, JobClass);
  const job = /** @type Job */ new JobClass(ctx, info, topic, jobName, storage);

  // list jobs
  if (info.method === 'GET' && !jobName) {
    ctx.attributes.authInfo.assertPermissions('job:list');
    return job.list(ctx, info);
  }

  const state = await job.loadState();
  if (!state) {
    log.info(`job ${job.stateKey} does not exist.`);
    return new Response('', {
      status: 404,
    });
  }

  // get job
  if (info.method === 'GET') {
    return job.getStatusResponse(report);
  }

  // run job
  if (info.method === 'RUN') {
    await job.invoke();
    return new Response('', {
      status: 204,
    });
  }

  // delete job
  ctx.attributes.authInfo.assertPermissions('job:write');
  await job.stop();
  return new Response('', {
    status: 204,
  });
}
