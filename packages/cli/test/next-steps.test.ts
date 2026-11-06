// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CLI says the next step (#30871, scope amendment item 4): after a
 * successful `os build` it names `os deploy`, and bare `os` (the root help
 * page) lists the everyday commands first.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from '@oclif/core';
import ObjectStackHelp from '../src/help.js';
import { BUILD_NEXT_STEP, EVERYDAY_COMMANDS, formatEverydayCommands } from '../src/utils/next-steps.js';
import Build from '../src/commands/build.js';
import Compile from '../src/commands/compile.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');

describe('bare os lists the everyday commands first', () => {
  it('every everyday id is a real command', () => {
    for (const { id } of EVERYDAY_COMMANDS) {
      const file = join(PKG, 'src', 'commands', ...id.split(' ')) + '.ts';
      expect(existsSync(file), `\`os ${id}\` is listed as an everyday command but ${file} does not exist`).toBe(true);
    }
  });

  it('the root help page carries the everyday block, deploy among it, ahead of the full listing', async () => {
    const config = await Config.load(PKG);
    const help = new ObjectStackHelp(config);
    const root = help.formatRoot();
    expect(root).toContain(formatEverydayCommands(config.bin));
    expect(root).toMatch(/EVERYDAY COMMANDS\n {2}\S+ dev /);
    expect(root).toContain(`${config.bin} deploy`);
    // The block closes the root section, so oclif prints TOPICS / COMMANDS after it.
    expect(root.trimEnd().endsWith(formatEverydayCommands(config.bin))).toBe(true);
  });

  it('is the help class oclif loads', async () => {
    const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(join(PKG, 'package.json'), 'utf8'));
    expect(pkg.oclif.helpClass).toBe('./dist/help.js');
  });
});

describe('os build names os deploy as the next step; os compile does not', () => {
  let dir = '';
  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function captured(run: () => Promise<unknown>): Promise<string> {
    const lines: string[] = [];
    const record = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    vi.spyOn(console, 'log').mockImplementation(record);
    vi.spyOn(console, 'error').mockImplementation(record);
    vi.spyOn(console, 'warn').mockImplementation(record);
    await run();
    vi.restoreAllMocks();
    return lines.join('\n');
  }

  async function stack(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'os-30871-next-step-'));
    const config = join(dir, 'objectstack.config.ts');
    await writeFile(config, "export default { manifest: { id: 'com.acme.hint', name: 'Hint', version: '1.0.0' } };\n");
    return config;
  }

  it('os build ends with the deploy hint', async () => {
    const config = await stack();
    const out = await captured(() => Build.run([config, '--output', join(dir, 'dist', 'objectstack.json')]));
    expect(out).toContain('Build complete');
    expect(out).toContain(BUILD_NEXT_STEP);
  });

  it('os compile — what os dev runs on every rebuild — prints no hint', async () => {
    const config = await stack();
    const out = await captured(() => Compile.run([config, '--output', join(dir, 'dist', 'objectstack.json')]));
    expect(out).toContain('Build complete');
    expect(out).not.toContain(BUILD_NEXT_STEP);
  });
});
