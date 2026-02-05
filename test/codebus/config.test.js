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

/* eslint-env mocha */
import assert from 'assert';
import path from 'path';
import { promises as fs } from 'fs';
import { aggregate, validate } from '../../src/codebus/config.js';

async function loadConfig(obj, name) {
  // eslint-disable-next-line no-param-reassign
  obj[name] = await fs.readFile(path.resolve(__testdir, 'codebus', 'fixtures', 'config', name));
}

describe('Config test', () => {
  const testConfigs = {};

  before(async () => {
    await loadConfig(testConfigs, 'fstab.yaml');
    await loadConfig(testConfigs, 'fstab-complex.yaml');
    await loadConfig(testConfigs, 'fstab-invalid.yaml');
    await loadConfig(testConfigs, 'head.html');
    await loadConfig(testConfigs, 'helix-query.yaml');
  });

  it('creates an aggregate config', async () => {
    const configChanges = {
      'fstab.yaml': {
        data: testConfigs['fstab.yaml'],
        lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      },
      'head.html': {
        data: testConfigs['head.html'],
        lastModified: 'Thu, 08 Jul 2021 10:05:16 GMT',
      },
    };
    const expected = JSON.parse(await fs.readFile(path.resolve(__testdir, 'codebus', 'fixtures', 'config', 'aggregate-all.json'), 'utf-8'));
    const combined = await aggregate(console, configChanges, {});
    assert.deepStrictEqual(combined, expected);
  });

  it('creates an aggregate config for a complex fstab', async () => {
    const configChanges = {
      'fstab.yaml': {
        data: testConfigs['fstab-complex.yaml'],
        lastModified: 'Thu, 08 Jul 2021 10:04:16 GMT',
      },
      'head.html': {
        data: testConfigs['head.html'],
        lastModified: 'Thu, 08 Jul 2021 10:05:16 GMT',
      },
    };
    const expected = JSON.parse(await fs.readFile(path.resolve(__testdir, 'codebus', 'fixtures', 'config', 'aggregate-complex.json'), 'utf-8'));
    const combined = await aggregate(console, configChanges, {});
    assert.deepStrictEqual(combined, expected);
  });

  it('creates an aggregate config of partial config', async () => {
    const configChanges = {
      'fstab.yaml': {
        data: testConfigs['fstab.yaml'],
      },
      'head.html': {
        data: testConfigs['head.html'],
      },
      'helix-query.yaml': {
      },
    };
    const expected = JSON.parse(await fs.readFile(path.resolve(__testdir, 'codebus', 'fixtures', 'config', 'aggregate-partial.json'), 'utf-8'));
    const combined = await aggregate(console, configChanges, {});
    assert.deepStrictEqual(combined, expected);
  });

  it('rejects aggregate config with invalid config if previous config was defined', async () => {
    const configChanges = {
      'fstab.yaml': {
        data: testConfigs['fstab-invalid.yaml'],
      },
      'head.html': {
        data: testConfigs['head.html'],
      },
      'helix-query.yaml': {
      },
    };
    await assert.rejects(aggregate(console, configChanges, {
      fstab: {},
    }), new Error('Errors while aggregating configurations.'));
  });

  it('ignored aggregate config errors if previous config was missing', async () => {
    const configChanges = {
      'fstab.yaml': {
        data: testConfigs['fstab-invalid.yaml'],
      },
      'head.html': {
        data: testConfigs['head.html'],
      },
      'helix-query.yaml': {
      },
    };
    const expected = JSON.parse(await fs.readFile(path.resolve(__testdir, 'codebus', 'fixtures', 'config', 'aggregate-head.json'), 'utf-8'));
    const combined = await aggregate(console, configChanges, {});
    assert.deepStrictEqual(combined, expected);
  });

  it('validates correct config', async () => {
    assert.strictEqual(await validate(console, 'fstab.yaml', testConfigs['fstab.yaml']), true);
  });

  it('does not validate incorrect config', async () => {
    assert.strictEqual(await validate(console, 'fstab.yaml', testConfigs['fstab-invalid.yaml']), false);
  });

  it('validate non config', async () => {
    assert.strictEqual(await validate(console, 'some-file', null), true);
  });
});
