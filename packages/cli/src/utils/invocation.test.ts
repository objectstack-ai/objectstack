// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The judgments behind #10111's two loud failures, unit-tested where a spawn
 * cannot reach them.
 *
 * `test/invocation-loudness.e2e.test.ts` is the end-to-end half — it proves the
 * lines actually reach a shell's stderr in the right ORDER, with the right exit
 * status. What is pinned here instead is the part that is invisible from
 * outside: which invocations the entry predicate calls "this process was
 * pointed at me", and which errors count as an invocation error at all.
 *
 * The symlink and directory legs are the reason this file exists. #10086
 * measured ~8 spellings of the same entry guard across `scripts/`, all of them
 * blind to symlinks, and every one of them makes its script silently inert —
 * exit 0, no output. That is the exact defect #10111 removes, so a guard here
 * with the same hole would have been the bug wearing the fix's clothes. Ablate
 * `realOrSelf` out of `isProcessEntry` and the symlink and directory cases turn
 * red; nothing else in this file moves.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Flags, Parser } from '@oclif/core';

import { CLI_NAME } from './format.js';
import {
  INVOCATION_PREFIX,
  invocationFailureLine,
  isInvocationError,
  isProcessEntry,
  moduleEntryMisuseLines,
} from './invocation.js';

/**
 * A real `NonExistentFlagsError`, thrown by the REAL parser through its public
 * entry point — the same error `os dev --no-ui` produces. Hand-rolling a
 * look-alike would test the look-alike: `@oclif/core` does not export
 * `CLIParseError`, so the structural predicate is only worth anything if it is
 * checked against what oclif actually throws.
 */
async function realNonExistentFlagError(): Promise<unknown> {
  try {
    await Parser.parse(['--no-ui'], {
      flags: { ui: Flags.boolean({ description: 'as `dev` declares it — no allowNo' }) },
      strict: true,
    });
  } catch (error) {
    return error;
  }
  throw new Error('the parser accepted --no-ui: this fixture no longer reproduces the measured failure');
}

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-invocation-'));
  return dir;
}

describe('[#10111] isProcessEntry', () => {
  it('is false when there is no entry argument (node --eval, the REPL)', () => {
    expect(isProcessEntry(undefined, pathToFileURL(join(tmpdir(), 'anything.js')).href)).toBe(false);
    expect(isProcessEntry('', pathToFileURL(join(tmpdir(), 'anything.js')).href)).toBe(false);
  });

  it('is true for the plain `node <file>` invocation', () => {
    const dir = fixtureDir();
    try {
      const entry = join(dir, 'entry.js');
      writeFileSync(entry, '');
      expect(isProcessEntry(entry, pathToFileURL(entry).href)).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('is true through a SYMLINK — the leg every spelling in #10086 gets wrong', () => {
    const dir = fixtureDir();
    try {
      const entry = join(dir, 'entry.js');
      const link = join(dir, 'link.js');
      writeFileSync(entry, '');
      symlinkSync(entry, link);
      // `import.meta.url` names the REAL file (node resolves symlinks for the
      // module graph); `process.argv[1]` stays as the caller typed it. Comparing
      // only those two answers false here, and a guard that answers false goes
      // silently inert.
      expect(isProcessEntry(link, pathToFileURL(entry).href)).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('is true for `node <dir>`, where the entry argument names the index it resolved to', () => {
    const dir = fixtureDir();
    try {
      const pkg = join(dir, 'dist');
      mkdirSync(pkg);
      const entry = join(pkg, 'index.js');
      writeFileSync(entry, '');
      expect(isProcessEntry(pkg, pathToFileURL(entry).href)).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('is false for an unrelated entry — an ordinary `import` must not be aborted', () => {
    const dir = fixtureDir();
    try {
      const entry = join(dir, 'entry.js');
      const other = join(dir, 'some-other-tool.js');
      writeFileSync(entry, '');
      writeFileSync(other, '');
      expect(isProcessEntry(other, pathToFileURL(entry).href)).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('is false for a DIFFERENT file with the same basename', () => {
    // The other half of #10086's finding: two scripts there match on basename,
    // which fires on import as readily as it goes inert.
    const dir = fixtureDir();
    try {
      const here = join(dir, 'a');
      const there = join(dir, 'b');
      mkdirSync(here);
      mkdirSync(there);
      writeFileSync(join(here, 'index.js'), '');
      writeFileSync(join(there, 'index.js'), '');
      expect(isProcessEntry(join(there, 'index.js'), pathToFileURL(join(here, 'index.js')).href)).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('[#10111] moduleEntryMisuseLines', () => {
  const [first, second] = moduleEntryMisuseLines('/w/packages/cli/dist/index.js', '/w/packages/cli/bin/run.js');

  it('leads with the prefix a runner log can be grepped for', () => {
    expect(first.startsWith(`${INVOCATION_PREFIX}: `)).toBe(true);
    expect(second.startsWith(`${INVOCATION_PREFIX}: `)).toBe(true);
  });

  it('says on line one that running this file started nothing', () => {
    expect(first).toContain('/w/packages/cli/dist/index.js');
    expect(first).toContain('starts nothing');
  });

  it('names the real entry point — the question the reader is holding', () => {
    expect(second).toContain('/w/packages/cli/bin/run.js');
  });

  it('keeps each line on one line', () => {
    expect(first).not.toContain('\n');
    expect(second).not.toContain('\n');
  });
});

describe('[#10111] isInvocationError', () => {
  it('recognises what the real oclif parser throws for an unknown flag', async () => {
    expect(isInvocationError(await realNonExistentFlagError())).toBe(true);
  });

  it('does not claim an ordinary runtime failure', () => {
    expect(isInvocationError(new Error('ECONNREFUSED 127.0.0.1:3000'))).toBe(false);
    expect(isInvocationError(undefined)).toBe(false);
    expect(isInvocationError('a string')).toBe(false);
    expect(isInvocationError({ parse: {} })).toBe(false);
  });
});

describe('[#10111] invocationFailureLine', () => {
  it('is ONE line naming the rejected flag and the fact that nothing ran', async () => {
    const line = invocationFailureLine(await realNonExistentFlagError(), ['dev', '--no-ui']);
    expect(line).toBeDefined();
    expect(line).not.toContain('\n');
    expect(line!.startsWith(`${INVOCATION_PREFIX}: INVOCATION ERROR — `)).toBe(true);
    expect(line).toContain('Nonexistent flag: --no-ui');
    expect(line).toContain('The command never ran');
    expect(line).toContain('nothing is listening');
    expect(line).toContain(`Invoked as: ${INVOCATION_PREFIX} dev --no-ui`);
  });

  it('drops oclif’s `See more help with --help` tail, which is the second line of the message', async () => {
    const error = await realNonExistentFlagError();
    expect(String((error as Error).message)).toContain('See more help with --help');
    expect(invocationFailureLine(error, ['dev', '--no-ui'])).not.toContain('See more help');
  });

  it('returns undefined for a runtime failure, leaving oclif’s reporting untouched', () => {
    expect(invocationFailureLine(new Error('boom'), ['serve'])).toBeUndefined();
  });

  it('caps the echoed invocation so one long argument cannot wrap the line', async () => {
    const line = invocationFailureLine(await realNonExistentFlagError(), ['dev', `--app=${'x'.repeat(400)}`]);
    expect(line!.length).toBeLessThan(320);
    expect(line).toContain('...');
  });
});

describe('[#10111] the prefix', () => {
  it('is the CLI name `format.ts` declares — kept in sync by this test, not an import', () => {
    // `invocation.ts` imports nothing but node builtins on purpose: it is
    // reached from the bin shims' failure path, and pulling `format.ts` in
    // would drag chalk, zod and @objectstack/spec along with it.
    expect(INVOCATION_PREFIX).toBe(CLI_NAME);
  });
});
