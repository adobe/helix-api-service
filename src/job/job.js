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
import crypto from 'crypto';
import { encrypt, decrypt } from '@adobe/helix-shared-tokencache';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { Response } from '@adobe/fetch';
import { StatusCodeError } from '../support/StatusCodeError.js';
import { sleep } from '../support/utils.js';
import { JobStorage } from './storage.js';
// import { AuditBatch } from '../support/audit.js';
import { X_CONTENT_SOURCE_AUTH } from '../contentproxy/utils.js';

const X_CONTENT_SOURCE_AUTH_ENCRYPTED = 'x-content-source-authorization-encrypted';

/**
 * Encrypts a token with a key
 * @param ctx
 * @param value
 * @returns {string}
 */
export function encryptToken(ctx, value) {
  const enc = encrypt(ctx.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY, Buffer.from(value, 'utf-8'));
  return enc.toString('base64');
}

/**
 * Decrypts a token with a key
 * @param ctx
 * @param value
 * @returns {string}
 */
export function decryptToken(ctx, value) {
  const dec = decrypt(ctx.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY, Buffer.from(value, 'base64'));
  return dec.toString('utf-8');
}

/**
 * @typedef {import('../index').AdminContext} AdminContext
 * @typedef {import('../support/RequestInfo.js').RequestInfo} RequestInfo
 */

/**
 * @typedef HistoryEntry
 * @property {string} name
 * @property {string} time
 * @property {string} state - 'stopped' only
 * @property {string} [stopTime]
 */

/**
 * @typedef History
 * @property {string} topic
 * @property {HistoryEntry[]} jobs
 */

/**
 * @typedef JobOptions
 * @property {number} [maxQueued=1024] max allowed queued jobs per topic
 * @property {Class<Job>} jobClass class for creating the job
 * @property {string[]} roles the roles the job should have
 * @property {string} [user] email of the user that initiated the job
 * @property {object} [data={}]
 * @property {boolean} transient specifies a transient job that is not persisted
 */

/**
 * @template TData
 * @typedef JobState<TData>
 * @property {string} topic
 * @property {string} name
 * @property {string} state current state: 'created', 'running', 'stopped'
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} waiting
 * @property {TData & { phase: string }} data
 */

/**
 * Simple Job management support. Each job topic has a history file, eg:
 * `.helix/admin-jobs/preview.json` that contains completed jobs.
 *
 * Active job information is stored in the incoming directory:
 * `.helix/admin-jobs/preview/incoming/job-1234.json`
 *
 * Completed jobs are moved to the topic directory:
 * `.helix/admin-jobs/preview/job-1234.json`
 *
 * A job is cancelled when a `stop` file is present in the incoming directory:
 * `.helix/admin-jobs/preview/incoming/job-1234-stop.json`
 *
 * The atomicity of job creation is currently not guaranteed. i.e. concurrent invocations could
 * read the _empty_ history.json and each start a new job. worst case, more jobs than the allowed
 * concurrency would run. but the system should not break.
 *
 * @class
 * @template TStateData
 */
export class Job {
  /** @type {string} */
  name = undefined;

  /** @type {string} */
  topic = undefined;

  /** @type {AdminContext} */
  ctx = undefined;

  /** @type {RequestInfo} */
  info = undefined;

  /** @type {JobState<TStateData>} */
  state = undefined;

  /** @type {Record<string, unknown>} */
  properties = {};

  /**
   * time between state saves
   * @type {number}
   */
  saveStaleTime = 3000;

  /**
   * only check every second
   * @type {number}
   */
  stopCheckTime = 1000;

  /**
   * time of last state save
   * @type {number}
   */
  lastSaveTime = 0;

  /**
   * time of the last stop check time
   * @type {number}
   */
  lastStopCheckTime = 0;

  /**
   * transient jobs don't persist their state
   * @type {boolean}
   */
  transient = false;

  // eslint-disable-next-line no-unused-vars
  constructor(context, info, topic, name, storage, noAudit) {
    this.name = name;
    this.topic = topic;
    this.ctx = context;
    this.info = info;
    this.storage = storage;

    // TODO: enabled once audit is added
    // if (!noAudit) {
    //   this.auditBatch = new AuditBatch(info);
    // }

    this.state = null;
    // New jobs go to incoming directory by default
    this.stateKey = `${topic}/incoming/${name}.json`;
    this.stopKey = `${topic}/incoming/${name}-stop.json`;
    // Track the completed job path for when job finishes
    this.completedStateKey = `${topic}/${name}.json`;
  }

  /**
   * Sets the transient flag
   * @param {boolean} v
   * @return {Job} this
   */
  withTransient(v) {
    this.transient = v;
    return this;
  }

  /**
   * Return the current history file of the topic (new format)
   * @param {JobStorage} storage job storage
   * @param {string} topic Job Topic
   * @returns {Promise<History>} the history
   */
  static async getHistory(storage, topic) {
    const state = await storage.get(`${topic}.json`);
    if (state) {
      return JSON.parse(state.toString('utf-8'));
    }
    return {
      topic,
      jobs: [],
    };
  }

  /**
   * Remove old jobs from the history file.
   * @param {History} history
   * @return {HistoryEntry[]} removed jobs
   */
  static pruneOldJobs(history) {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const pruned = [];
    const kept = [];
    for (const job of history.jobs) {
      if (Date.parse(job.time) < sevenDaysAgo) {
        pruned.push(job);
      } else {
        kept.push(job);
      }
    }
    // eslint-disable-next-line no-param-reassign
    history.jobs = kept;
    return pruned;
  }

  /**
   * Store the history file (new format)
   * @param {JobStorage} storage job storage
   * @param {History} history the history data to store
   * @returns {Promise<any>} state or null
   */
  static async setHistory(storage, history) {
    await storage.put(`${history.topic}.json`, JSON.stringify(history), 'application/json');
  }

  /**
   * Creates a new Job for the given topic. It invokes the admin service async and
   * and returns informational response.
   * @param {AdminContext} ctx the universal context
   * @param {RequestInfo} info path info
   * @param {string} topic
   * @param {JobOptions} opts
   * @return {Promise<Response>}
   */
  static async create(ctx, info, topic, opts = {}) {
    const {
      maxQueued = 1024, data = {}, roles = [],
      user = ctx.attributes?.authInfo?.resolveEmail(),
      jobClass = Job, noAudit = false,
    } = opts;
    let { transient } = opts;

    const storage = await JobStorage.create(ctx, info, jobClass);
    const createTime = new Date().toISOString();

    // turns '2025-01-23T10:33:21.322Z' into '2025-01-23-10-33-21' and appends 8 random hex digits
    const jobName = `job-${createTime.replace(/\.\d+Z$/, '').replaceAll(/[:.T]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;

    let oldJobs = [];

    if (transient && String(ctx.data?.forceAsync) === 'true') {
      ctx.log.info(`forcing async for ${jobName} due to "forceAsync=true".`);
      transient = false;
    } else if (!transient && String(ctx.data?.forceSync) === 'true') {
      ctx.log.info(`forcing sync for ${jobName} due to "forceSync=true".`);
      transient = true;
    }

    // check if there is already a job running, and if not, allocate one
    if (!transient) {
      // Count active jobs in the incoming directory
      const incomingJobs = await storage.list(`${topic}/incoming/`);
      const activeJobFiles = incomingJobs.filter((item) => (
        item.key.endsWith('.json') && !item.key.endsWith('-stop.json')
      ));

      if (activeJobFiles.length >= maxQueued) {
        throw new StatusCodeError(`max ${maxQueued} ${topic} jobs already queued.`, 409);
      }

      // Prune old completed jobs from history
      const history = await Job.getHistory(storage, topic);
      oldJobs = Job.pruneOldJobs(history);
      if (oldJobs.length > 0) {
        await Job.setHistory(storage, history);
      }
    }

    // also allocate the job's state file
    const JobClass = opts.jobClass || Job;
    const job = new JobClass(ctx, info, topic, jobName, storage, noAudit)
      .withTransient(transient);
    await job.writeState({
      topic,
      user,
      name: jobName,
      state: 'created',
      createTime,
      data,
    });

    const { org, site } = info;
    const {
      log,
      runtime: { region, accountId },
      func: { fqn: funcName },
      invocation: { id: invocationId },
    } = ctx;

    if (process.env.HLX_DEV_SERVER_HOST || transient) {
      await job.invoke();
      const body = {
        job: await job.loadState(),
        links: {
          list: Job.getApiLink(info, topic),
          self: Job.getApiLink(info, topic, jobName),
        },
      };

      // remove old job files if not transient (dev server)
      /* c8 ignore next 4 */
      if (!transient && oldJobs.length) {
        log.info(`removing ${oldJobs.length} old jobs states from ${storage.prefix}/${topic}`);
        await storage.remove(oldJobs.map(({ name }) => `${topic}/${name}.json`));
      }

      return new Response(JSON.stringify(body, null, 2), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    }

    const headers = {
      'x-invocation-id': invocationId,
    };
    if (info.headers?.[X_CONTENT_SOURCE_AUTH]) {
      // eslint-disable-next-line max-len
      headers[X_CONTENT_SOURCE_AUTH_ENCRYPTED] = encryptToken(ctx, info.headers[X_CONTENT_SOURCE_AUTH]);
    }

    // for individual ci versions, invoke the function. the 'ci' alias is triggered via SQS
    if (ctx.func?.version.startsWith('ci') && ctx.func?.version !== 'ci') {
      const client = new LambdaClient({ region });
      try {
        const result = await client.send(new InvokeCommand({
          FunctionName: funcName,
          InvocationType: InvocationType.Event,
          Payload: JSON.stringify({
            Records: [{
              messageId: invocationId,
              body: JSON.stringify({
                method: 'RUN',
                path: `/${org}/sites/${site}/jobs/${topic}/${jobName}`,
                headers,
                roles,
                user,
                body: '',
              }),
            }],
          }),
        }));
        const body = {
          job: job.state,
          requestId: result.$metadata.requestId,
          links: {
            list: Job.getApiLink(info, topic),
            self: Job.getApiLink(info, topic, jobName),
          },
        };
        return new Response(JSON.stringify(body, null, 2), {
          status: 202,
          headers: {
            'content-type': 'application/json',
          },
        });
      } finally {
        client.destroy();
      }
    }

    // add job to queue
    const sqs = new SQSClient();
    const jobQueueUrl = ctx.func?.version === 'ci'
      ? `https://sqs.${region}.amazonaws.com/${accountId}/helix-api-service-jobs-ci.fifo`
      : `https://sqs.${region}.amazonaws.com/${accountId}/helix-api-service-jobs.fifo`;

    try {
      const result = await sqs.send(new SendMessageCommand({
        QueueUrl: jobQueueUrl,
        MessageGroupId: `${storage.project}/${topic}`, // group by project and job topic
        MessageBody: JSON.stringify({
          method: 'RUN',
          path: `/${org}/sites/${site}/jobs/${topic}/${jobName}`,
          headers,
          roles,
          user,
          body: '',
        }),
      }));

      const body = {
        messageId: result.MessageId,
        job: job.state,
        links: {
          list: Job.getApiLink(info, topic),
          self: Job.getApiLink(info, topic, jobName),
        },
      };

      log.info(`scheduled background job ${topic}/${jobName}: messageId: ${body.messageId} using ${jobQueueUrl}.`);

      // remove old jobs files (this is intentionally after the job is queued)
      if (oldJobs.length) {
        log.info(`removing ${oldJobs.length} old jobs states from ${storage.prefix}/${topic}`);
        await storage.remove(oldJobs.map(({ name }) => `${topic}/${name}.json`));
      }

      return new Response(JSON.stringify(body, null, 2), {
        status: 202,
        headers: {
          'content-type': 'application/json',
        },
      });
    } finally {
      sqs.destroy();
    }
  }

  /**
   * Returns the API link for the given job topic and optional name
   * @param {RequestInfo} info
   * @param {string} topic
   * @param {string} [jobName]
   * @return {string}
   */
  static getApiLink(info, topic, jobName = '') {
    if (jobName) {
      return info.getLinkUrl(`/${info.org}/sites/${info.site}/jobs/${topic}/${jobName}`);
    }
    return info.getLinkUrl(`/${info.org}/sites/${info.site}/jobs/${topic}/`);
  }

  /**
   * Extracts extra info to be included in the history. for example the code job might include
   * the synced branch.
   * @param state
   * @return {object}
   */
  // eslint-disable-next-line class-methods-use-this,no-unused-vars
  extractHistoryExtraInfo(state) {
    return {};
  }

  /**
   * Lists the jobs for the given topic.
   * @param {AdminContext} ctx the universal context
   * @param {RequestInfo} info path info
   * @return {Promise<Response>}
   */
  async list(ctx, info) {
    const jobs = [];

    // Get completed jobs from history
    const history = await Job.getHistory(this.storage, this.topic);
    jobs.push(...history.jobs);

    // Get active jobs from incoming directory
    const activeJobFiles = await this.storage.list(`${this.topic}/incoming/`);

    // Load state for each active job to get metadata
    for (const file of activeJobFiles) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const state = await this.storage.get(file.key);
        if (state) {
          const jobState = JSON.parse(state.toString('utf-8'));
          jobs.push({
            name: jobState.name,
            time: jobState.createTime,
            state: jobState.state || 'created',
            stopTime: jobState.stopTime,
            ...this.extractHistoryExtraInfo(jobState),
          });
        }
      } catch (e) {
        ctx.log.warn(`Failed to load job state from ${file.key}:`, e.message);
      }
    }

    const topicPath = `/${info.org}/sites/${info.site}/jobs/${this.topic}/`;
    const body = {
      topic: this.topic,
      jobs: jobs.map((job) => ({
        ...job,
        href: info.getLinkUrl(`${topicPath}${job.name}`),
      })),
      links: {
        self: info.getLinkUrl(topicPath),
      },
    };
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  async setPhase(phase) {
    this.state.data.phase = phase;
    await this.writeState();
  }

  // TODO: test once audit is added
  /* c8 ignore next 7 */
  setProperties(props) {
    this.properties = {
      ...this.properties,
      ...props,
    };
  }

  toString() {
    return `${this.storage.project}/${this.topic}/${this.name}`;
  }

  /**
   * Performs the job action. Should be overridden by the respective sub classes.
   * @return {Promise<void>}
   */
  async run() {
    this.ctx.log.info('Job.run() invoked. this is probably not intended. subclasses should override this method.');
  }

  /**
   * Invokes the current job by updating the status and internally calling {@link #run()}
   * @return {Promise<void>}
   */
  async invoke() {
    const { log } = this.ctx;
    if (await this.checkStopped(true)) {
      log.info(`job ${this} already stopped.`);
      return;
    }
    // this might not be the best place. maybe in the SQS adapter?
    if (this.info.headers?.[X_CONTENT_SOURCE_AUTH_ENCRYPTED]) {
      // eslint-disable-next-line max-len
      this.info.headers[X_CONTENT_SOURCE_AUTH] = decryptToken(this.ctx, this.info.headers[X_CONTENT_SOURCE_AUTH_ENCRYPTED]);
    }

    const start = Date.now();
    try {
      this.state.state = 'running';
      this.state.startTime = new Date().toISOString();
      this.state.stopTime = '';
      if (this.state.invocationId) {
        if (!Array.isArray(this.state.invocationId)) {
          this.state.invocationId = [this.state.invocationId];
        }
        this.state.invocationId.push(this.ctx.invocation.id);
      } else {
        this.state.invocationId = this.ctx.invocation.id;
      }
      await this.writeState();

      log.info(`job ${this} started (${this.ctx.func.version}).`);

      try {
        await this.run();
      } catch (e) {
        log.warn('error during job execution', e);
        this.state.error = e.message;
      }

      this.state.stopTime = new Date().toISOString();
      this.state.state = 'stopped';

      await this.writeState();

      // Move job from incoming to completed location and update history
      if (!this.transient) {
        try {
          // Move the job file from incoming to topic directory
          await this.storage.move(this.stateKey, this.completedStateKey);
          log.info(`moved job ${this} from incoming to completed location.`);

          // Update the history file
          const history = await Job.getHistory(this.storage, this.topic);
          history.jobs.push({
            name: this.name,
            time: this.state.createTime,
            state: 'stopped',
            stopTime: this.state.stopTime,
            ...this.extractHistoryExtraInfo(this.state),
          });
          await Job.setHistory(this.storage, history);
          log.info(`updated job ${this} in history.`);
        } catch (e) {
          log.error(`failed to move job ${this} to completed location:`, e.message);
          // Continue anyway - the job completed successfully
        }
      }

      log.info(`job ${this} stopped ${this.state.cancelled ? '(cancelled)' : ''}.`);
    } finally {
      // audit first
      const stop = Date.now();
      const auditInfo = {
        ...this.info,
        method: 'POST',
      };
      const status = (this.state.progress?.failed > 0 || this.state.error) ? 207 : 200;
      // TODO: test once audit is added
      /* c8 ignore next 16 */
      if (this.auditBatch) {
        await this.auditBatch.add(this.ctx, auditInfo, {
          res: new Response('', { status }),
          start,
          stop,
          properties: {
            ...this.properties,
            job: `${this.topic}/${this.name}`,
          },
        });
        await this.auditBatch.send(this.ctx);
      }
      if (!this.transient) {
        // delete stop file
        try {
          await this.storage.remove(this.stopKey);
          /* c8 ignore next 3 */
        } catch {
          // ignore
        }
      }
      log.info(`job ${this} finalized.`);
    }
  }

  /**
   * Checks if the stop file is present.
   * @param {boolean} force force check
   * @return {Promise<boolean>} true if stopped
   */
  async checkStopped(force = false) {
    if (this.state.cancelled && !force) {
      return true;
    }
    if (this.transient) {
      return false;
    }
    const now = Date.now();
    if (force || now >= this.lastStopCheckTime + this.stopCheckTime) {
      this.lastStopCheckTime = now; // prevent that a concurrent save could happen
      const stop = await this.storage.get(this.stopKey);
      if (stop) {
        this.ctx.log.info(`job ${this} is scheduled to be stopped.`, stop.toString());
        this.state.cancelled = true;
      }
    }
    return !!this.state.cancelled;
  }

  /**
   * waits for the given timeout in ms. exposed for testing.
   * @param timeout
   * @return {Promise<void>}
   */
  /* c8 ignore next 4 */
  // eslint-disable-next-line class-methods-use-this
  async wait(timeout = 0) {
    await sleep(timeout);
  }

  /**
   * Waits in idle state, periodically updating the job's waiting time and checking for stop
   * requests.
   * @param {number} timeout Time in milliseconds to wait.
   * @return {Promise<void>}
   */
  async idleWait(timeout = 0) {
    if (timeout === 0) {
      return;
    }
    const end = Date.now() + timeout;
    let remaining = timeout;
    while (remaining > 0) {
      this.state.waiting = remaining;
      // eslint-disable-next-line no-await-in-loop
      await this.writeState();
      // eslint-disable-next-line no-await-in-loop
      await this.wait(2000);
      // eslint-disable-next-line no-await-in-loop
      if (await this.checkStopped(true)) {
        break;
      }
      remaining = end - Date.now();
    }
    this.state.waiting = 0;
    await this.writeState();
  }

  /**
   * Writes the stop file if needed, putting the job into the 'stopping' state
   * (although not reflected in the job state file)
   * @return {Promise<void>}
   */
  async stop() {
    const { log, invocation: { id: invocationId } } = this.ctx;
    if (this.state.state === 'stopped') {
      log.info(`job ${this.topic}/${this.name} already stopped.`);
      return;
    }
    if (this.transient) {
      this.state.state = 'stopped';
      return;
    }

    // check if stop file exists
    const stop = await this.storage.get(this.stopKey);
    if (stop) {
      log.info(`job ${this.topic}/${this.name} already scheduled to be stopped.`, stop.toString());
      return;
    }
    await this.storage.put(this.stopKey, JSON.stringify({
      invocationId,
      time: new Date().toISOString(),
    }), 'application/json');
  }

  /**
   * Writes the state but delays it by `this.saveStaleTime()` to avoid generating too many
   * storage requests.
   * @return {Promise<void>}
   */
  async writeStateLazy() {
    const now = Date.now();
    if (now >= this.lastSaveTime + this.saveStaleTime) {
      this.lastSaveTime = now; // prevent that a concurrent save could happen
      await this.writeState();
    }
  }

  /**
   * Stores the given job state to the storage
   * @param {JobState} state
   * @return {Promise<void>}
   */
  async writeState(state = this.state) {
    if (!this.transient) {
      await this.storage.put(this.stateKey, JSON.stringify(state), 'application/json', {}, true);
    }
    this.lastSaveTime = Date.now();
    this.state = state;
  }

  /**
   * Loads the given job state from the storage. returns {@code null} if job does not exit.
   * Checks incoming/ directory first, then completed location, then legacy location.
   * @return {Promise<void>}
   */
  async loadState() {
    if (!this.transient) {
      // Try incoming directory first (active jobs)
      let buf = await this.storage.get(this.stateKey);

      // If not in incoming, try completed location
      if (!buf) {
        buf = await this.storage.get(this.completedStateKey);
        if (buf) {
          // Update internal keys to point to completed location
          this.stateKey = this.completedStateKey;
          this.stopKey = `${this.topic}/${this.name}-stop.json`;
        }
      }

      this.state = buf ? JSON.parse(buf.toString('utf-8')) : null;
      if (this.state?.user) {
        const { authInfo } = this.ctx.attributes;
        authInfo.withProfile({
          ...(authInfo.profile ?? {}),
          email: this.state.user,
        });
      }
    }
    return this.state;
  }

  /**
   * Returns the status response for the job
   * @param {string} report name of the report
   * @return {Promise<Response>}
   */
  async getStatusResponse(report = '') {
    let body;
    const state = this.ctx.attributes?.authInfo?.hasPermissions?.('log:read')
      ? this.state
      : { ...this.state, user: undefined };
    if (report === 'details') {
      body = {
        ...state,
        links: {
          list: Job.getApiLink(this.info, this.topic),
          job: Job.getApiLink(this.info, this.topic, this.name),
          self: Job.getApiLink(this.info, this.topic, `${this.name}/details`),
        },
      };
    } else {
      body = {
        ...state,
        data: undefined,
        links: {
          list: Job.getApiLink(this.info, this.topic),
          self: Job.getApiLink(this.info, this.topic, this.name),
          details: Job.getApiLink(this.info, this.topic, `${this.name}/details`),
        },
      };
    }
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  /**
   * tracks the progress
   * @param {ProgressInfo} stat
   */
  async trackProgress(stat) {
    if (!this.state.progress) {
      this.state.progress = {
        total: 0,
        processed: 0,
        failed: 0,
      };
    }
    for (const [key, value] of Object.entries(stat)) {
      this.state.progress[key] = value;
    }
    await this.writeStateLazy();
  }

  /**
   * Audit an operation on a single resource.
   */
  async audit(ctx, info, opts) {
    // TODO: test once audit is added
    /* c8 ignore next 3 */
    if (this.auditBatch) {
      await this.auditBatch.add(ctx, info, { ...opts, logDetails: false });
    }
  }
}
