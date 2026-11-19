// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import hook, { commandNotFoundMessage, type CommandNotFoundConfig } from './point-at-help.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '../../../package.json');

/** A command table with one topic (`environments`), one nested topic and one command under a topic. */
const config: CommandNotFoundConfig = {
  bin: 'os',
  topicSeparator: ' ',
  findTopic: (id) => ['environments', 'plugin', 'plugin:trust', 'migrate'].includes(id),
  findCommand: (id) => ['migrate:plan', 'dev'].includes(id),
};

const refusal = async (id: string): Promise<any> => {
  try {
    await (hook as unknown as (opts: { id: string; config: CommandNotFoundConfig }) => Promise<unknown>)({ id, config });
  } catch (error) {
    return error;
  }
  throw new Error('expected the hook to refuse');
};

describe('an unknown command points at the help that lists the real ones', () => {
  it('a topic-level unknown subcommand: the id as typed, and the topic\'s own help', async () => {
    const error = await refusal('environments:frobnicate');
    expect(error.oclif?.exit).toBe(2);
    expect(error.message).toBe('command environments frobnicate not found\nSee more help with `os environments --help`');
  });

  it('a top-level unknown command points at the root help', async () => {
    const error = await refusal('frobnicate');
    expect(error.oclif?.exit).toBe(2);
    expect(error.message).toBe('command frobnicate not found\nSee more help with `os --help`');
  });

  it('the deepest topic or command the typed words reached is the one named', () => {
    expect(commandNotFoundMessage('plugin:trust:frobnicate', config)).toContain('`os plugin trust --help`');
    expect(commandNotFoundMessage('migrate:plan:frobnicate', config)).toContain('`os migrate plan --help`');
    expect(commandNotFoundMessage('nope:frobnicate', config)).toContain('`os --help`');
  });

  it('is registered as the CLI\'s command_not_found hook, from the built tree', () => {
    const manifest = JSON.parse(readFileSync(PKG, 'utf8'));
    expect(manifest.oclif.hooks.command_not_found).toBe('./dist/hooks/command-not-found/point-at-help.js');
  });
});
