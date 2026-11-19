// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34777] `os lint --item <file> --type <type>` — the oclif command, in
 * process: the `--json` face carries the findings of the rules that judged the
 * item, the rules and families that did not, and the exit code a project run
 * would give; the text face names the same rules; every flag combination the
 * mode does not read is refused with exit 1 instead of being ignored.
 *
 * `process.exit` is stubbed to throw, so a refusal is observed as the code it
 * asked for rather than ending the worker.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Lint from '../src/commands/lint.js';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** SGR codes, written as `\x1b` and never as the raw byte. */
const SGR = /\x1b\[[0-9;]*m/g;

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function itemFile(body: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'os-lint-item-34777-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'item.json');
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

class ExitCalled extends Error {
  constructor(readonly code: number) { super(`process.exit(${code})`); }
}

async function runLint(argv: string[]): Promise<{ out: string; exitCode: number }> {
  const chunks: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { chunks.push(a.map(String).join(' ')); });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { chunks.push(a.map(String).join(' ')); });
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, a?: unknown, b?: unknown) => {
    chunks.push(String(chunk));
    const done = typeof a === 'function' ? a : b;
    if (typeof done === 'function') (done as (e?: Error | null) => void)(null);
    return true;
  }) as never);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new ExitCalled(code ?? 0); }) as never);
  const saved = process.exitCode;
  process.exitCode = undefined;
  let exitCode = 0;
  try {
    await Lint.run(argv, { root: CLI_ROOT });
    exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    if (!(error instanceof ExitCalled)) throw error;
    exitCode = error.code;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    writeSpy.mockRestore();
    exitSpy.mockRestore();
    process.exitCode = saved;
  }
  return { out: chunks.join('\n').replace(SGR, ''), exitCode };
}

const CLEAN = { name: 'invoice', label: 'Invoice', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } };
const RETIRED_TITLE = { ...CLEAN, titleFormat: '{title}' };

describe('[#34777] os lint --item --type', () => {
  it('declares both flags, and each names the other', () => {
    const flags = Lint.flags as Record<string, any>;
    expect(flags.item.type).toBe('option');
    expect(flags.type.type).toBe('option');
    expect(flags.item.description).toContain('--type');
    expect(flags.type.description).toContain('--item');
  });

  it('--json, a clean item: passed, exit 0, and the rules that did and did not judge it', async () => {
    const run = await runLint(['--item', itemFile(CLEAN), '--type', 'object', '--json']);
    expect(run.exitCode).toBe(0);
    const payload = JSON.parse(run.out);
    expect(payload.passed).toBe(true);
    expect(payload.type).toBe('object');
    expect(payload.errors).toBe(0);
    expect(payload.judged).toContain('validateTitleFormatRetired');
    expect(payload.notJudged.map((n: any) => n.rule)).toContain('validateStackExpressions');
    expect(payload.familiesNotRun.map((f: any) => f.family)).toContain('i18n coverage');
  });

  it('--json, an item a judged rule refuses: the error is reported and the run exits 1', async () => {
    const run = await runLint(['--item', itemFile(RETIRED_TITLE), '--type', 'objects', '--json']);
    expect(run.exitCode).toBe(1);
    const payload = JSON.parse(run.out);
    expect(payload.passed).toBe(false);
    expect(payload.failing).toBe(1);
    expect(payload.issues.map((i: any) => i.rule)).toEqual(['title-format-retired']);
  });

  it('runs os lint\'s per-entry conventions on the item', async () => {
    const run = await runLint(['--item', itemFile({ ...CLEAN, label: 'invoice' }), '--type', 'object', '--json']);
    expect(JSON.parse(run.out).issues.map((i: any) => i.rule)).toContain('convention/label-case');
  });

  it('the text face names the rules it could not run', async () => {
    const run = await runLint(['--item', itemFile(CLEAN), '--type', 'object']);
    expect(run.exitCode).toBe(0);
    expect(run.out).toContain('Not run without the rest of the stack');
    expect(run.out).toContain('validateStackExpressions');
    expect(run.out).toContain('naming/namespace-prefix');
  });

  it.each([
    [['--type', 'object'], '--type names the type of an --item file'],
    [['--item', 'x.json'], '--item needs --type'],
    [['--item', 'x.json', '--type', 'object', 'objectstack.config.ts'], 'not both'],
    [['--item', 'x.json', '--type', 'object', '--score'], '--score grades a whole project'],
    [['--item', 'x.json', '--type', 'object', '--eval'], 'Run them separately'],
  ])('refuses %j with exit 1 on both faces', async (argv, words) => {
    const text = await runLint(argv as string[]);
    expect(text.exitCode).toBe(1);
    expect(text.out).toContain(words);
    const json = await runLint([...(argv as string[]), '--json']);
    expect(json.exitCode).toBe(1);
    expect(JSON.parse(json.out).error).toContain(words);
  });

  it('refuses an unknown type, invalid JSON and a non-object body with exit 1', async () => {
    const unknown = await runLint(['--item', itemFile(CLEAN), '--type', 'widget', '--json']);
    expect(unknown.exitCode).toBe(1);
    expect(JSON.parse(unknown.out).error).toContain("'widget' is not a metadata type");
    const invalid = await runLint(['--item', itemFile('{ nope'), '--type', 'object', '--json']);
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.out).error).toContain('Invalid JSON');
    const list = await runLint(['--item', itemFile([CLEAN]), '--type', 'object', '--json']);
    expect(list.exitCode).toBe(1);
    expect(JSON.parse(list.out).error).toContain('one metadata item');
  });
});
