/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import crypto from 'crypto';

export class SQSNock {
  constructor(nocker, queue, entries) {
    const fifo = queue.endsWith('.fifo');
    const parse = fifo ? 'parseFifo' : 'parseStandard';

    nocker('https://sqs.us-east-1.amazonaws.com')
      .post('/', (body) => {
        const { QueueUrl = '' } = body;
        return QueueUrl.split('/').at(-1) === queue;
      })
      .optionally(true)
      .reply((_, body) => {
        const { Entries } = JSON.parse(body);
        if (entries) {
          entries.push(...this[parse](Entries));
        }
        return [200, JSON.stringify({
          MessageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
          MD5OfMessageBody: crypto.createHash('md5').update(body, 'utf-8').digest().toString('hex'),
        })];
      });
  }

  // eslint-disable-next-line class-methods-use-this
  parseStandard(entries) {
    return entries.map(({ MessageAttributes, MessageBody }) => {
      const messageBody = JSON.parse(MessageBody);
      delete messageBody.timestamp;

      return {
        MessageAttributes,
        MessageBody: messageBody,
      };
    });
  }

  // eslint-disable-next-line class-methods-use-this
  parseFifo(entries) {
    return entries.map(({ MessageBody, MessageGroupId }) => {
      const messageBody = JSON.parse(MessageBody);
      // eslint-disable-next-line no-param-reassign
      messageBody.updates.forEach((update) => delete update.result.timestamp);

      return {
        MessageBody: messageBody,
        MessageGroupId,
      };
    });
  }
}
