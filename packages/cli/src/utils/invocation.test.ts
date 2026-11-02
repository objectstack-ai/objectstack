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
import { Args, Command, Errors, Flags, Parser } from '@oclif/core';

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

/**
 * Whatever the REAL parser throws for `argv` against `input` — the shared shape
 * of the parse-time cases below. Every one of them is thrown through
 * `Parser.parse`, the public entry point, for the same reason as
 * {@link realNonExistentFlagError}: the predicate is only worth anything against
 * what oclif actually throws.
 */
async function realParseFailure(argv: string[], input: Parameters<typeof Parser.parse>[1]): Promise<unknown> {
  try {
    await Parser.parse(argv, { strict: true, ...input });
  } catch (error) {
    return error;
  }
  throw new Error(`the parser accepted ${JSON.stringify(argv)}: this fixture no longer reproduces a parse failure`);
}

/**
 * A command that PARSED fine and then failed in its own body with
 * `this.error()` — the commonest runtime failure in this CLI. oclif gives it
 * the same class, the same own fields and the same exit 2 as the parse-time
 * `CLIError`s, which is why the predicate cannot read any of those.
 */
async function realRuntimeCommandError(): Promise<unknown> {
  class RanAndFailed extends Command {
    static override flags = { database: Flags.string({ char: 'd' }) };
    async run(): Promise<void> {
      await this.parse(RanAndFailed);
      this.error('objectstack.config.ts not found');
    }
  }
  // A bare oclif root: loading this package's own config would import every
  // command module, ~5 s for one fixture.
  const root = fixtureDir();
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0', oclif: {} }));
  try {
    await RanAndFailed.run(['-d', 'file.db'], { root });
  } catch (error) {
    return error;
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
  throw new Error('the command did not fail: this fixture no longer reproduces a runtime failure');
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

  // The parse failures oclif raises as a PLAIN `CLIError` from inside its
  // parser — no `parse` / `showHelp` fields — measured on `os dev -d`,
  // `os serve --port`, `os migrate meta --from`, `os dev --log-level`,
  // `os dev -p 1 -p 2` and `os lint --eval-min abc`: each exited 2 with no banner.
  it('recognises a flag given without its value (`os dev -d`)', async () => {
    const error = await realParseFailure(['-d'], { flags: { database: Flags.string({ char: 'd' }) } });
    expect(String((error as Error).message)).toBe('Flag --database expects a value');
    expect(isInvocationError(error)).toBe(true);
  });

  it('recognises a flag with an option list given without its value (`os dev --log-level`)', async () => {
    const error = await realParseFailure(['--log-level'], {
      flags: { 'log-level': Flags.string({ options: ['debug', 'info'] }) },
    });
    expect(isInvocationError(error)).toBe(true);
  });

  it('recognises a single-valued flag given twice (`os dev -p 1 -p 2`)', async () => {
    const error = await realParseFailure(['-p', '1', '-p', '2'], { flags: { port: Flags.string({ char: 'p' }) } });
    expect(isInvocationError(error)).toBe(true);
  });

  it('recognises a value the flag’s own parser refused (`os lint --eval-min abc`)', async () => {
    const error = await realParseFailure(['--eval-min', 'abc'], { flags: { 'eval-min': Flags.integer() } });
    expect(isInvocationError(error)).toBe(true);
  });

  // The other classes the parser raises at the same place already carry the
  // `CLIParseError` fields and printed the banner before; pinned so the
  // reading keeps covering them.
  it('recognises a missing required flag, a missing required arg and an unexpected arg', async () => {
    const required = await realParseFailure([], { flags: { out: Flags.string({ required: true }) } });
    const missingArg = await realParseFailure([], { args: { id: Args.string({ required: true }) } });
    const extraArg = await realParseFailure(['a', 'b'], { args: { id: Args.string({ required: true }) } });
    expect(isInvocationError(required)).toBe(true);
    expect(isInvocationError(missingArg)).toBe(true);
    expect(isInvocationError(extraArg)).toBe(true);
  });

  it('does not claim a command that parsed and then failed — same class, fields and exit 2 as a parse failure', async () => {
    const runtime = await realRuntimeCommandError();
    const parseTime = await realParseFailure(['-d'], { flags: { database: Flags.string({ char: 'd' }) } });
    // The measured reason the predicate cannot read the error's class or fields.
    expect((runtime as Error).constructor).toBe((parseTime as Error).constructor);
    expect(Object.getOwnPropertyNames(runtime).sort()).toEqual(Object.getOwnPropertyNames(parseTime).sort());
    expect((runtime as { oclif?: unknown }).oclif).toEqual({ exit: 2 });
    expect(isInvocationError(runtime)).toBe(false);
  });

  it('does not claim a bare `Errors.error()` thrown outside the parser', () => {
    let thrown: unknown;
    try {
      Errors.error('ECONNREFUSED 127.0.0.1:3000');
    } catch (error) {
      thrown = error;
    }
    expect(isInvocationError(thrown)).toBe(false);
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

  it('names the flag that is missing its value (`os dev -d`)', async () => {
    const error = await realParseFailure(['-d'], { flags: { database: Flags.string({ char: 'd' }) } });
    const line = invocationFailureLine(error, ['dev', '-d']);
    expect(line).toBeDefined();
    expect(line!.startsWith(`${INVOCATION_PREFIX}: INVOCATION ERROR — Flag --database expects a value. `)).toBe(true);
    expect(line).toContain(`Invoked as: ${INVOCATION_PREFIX} dev -d`);
  });

  // oclif spreads these reasons over several lines under a generic header; the
  // banner used to keep only the header ("The following error occurred:.",
  // "Parsing --eval-min.") and so named no reason at all.
  it('names the missing required flag, not only oclif’s header (`os plugin keygen`)', async () => {
    const error = await realParseFailure([], { flags: { out: Flags.string({ char: 'o', required: true }) } });
    expect(String((error as Error).message).split('\n')[0]).toBe('The following error occurred:');
    const line = invocationFailureLine(error, ['plugin', 'keygen']);
    expect(line).toContain('INVOCATION ERROR — The following error occurred: Missing required flag out. The command never ran');
  });

  it('names the value a flag’s parser refused, not only `Parsing --X` (`os lint --eval-min abc`)', async () => {
    const error = await realParseFailure(['--eval-min', 'abc'], { flags: { 'eval-min': Flags.integer() } });
    const line = invocationFailureLine(error, ['lint', '--eval-min', 'abc']);
    expect(line).toContain('INVOCATION ERROR — Parsing --eval-min; Expected an integer but received: abc. The command never ran');
  });

  it('keeps a joined reason on one line, free of colour codes and of the help tail', async () => {
    const error = await realParseFailure([], { args: { id: Args.string({ description: 'The installed plugin id', required: true }) } });
    const line = invocationFailureLine(error, ['plugin', 'uninstall']);
    expect(line).toContain('INVOCATION ERROR — Missing 1 required arg: id The installed plugin id. The command never ran');
    expect(line).not.toContain('\n');
    expect(line).not.toContain('See more help');
    const dimmed = Object.assign(new Error('The following error occurred:\n  \u001b[2mMissing required flag out\u001b[22m'), { parse: {}, showHelp: false });
    expect(invocationFailureLine(dimmed, ['plugin', 'keygen'])).toContain('occurred: Missing required flag out. The command');
    expect(invocationFailureLine(dimmed, ['plugin', 'keygen'])).not.toContain('\u001b');
  });

  it('caps a long joined reason so the line cannot run on', () => {
    const long = Object.assign(new Error(`Missing 9 required args:\n${'an argument with a long description\n'.repeat(20)}`), { parse: {}, showHelp: true });
    const line = invocationFailureLine(long, ['plugin', 'uninstall']);
    expect(line).toContain('.... The command never ran');
    expect(line!.length).toBeLessThan(450);
  });

  it('returns undefined for a command that parsed and then failed', async () => {
    expect(invocationFailureLine(await realRuntimeCommandError(), ['dev', '-d', 'file.db'])).toBeUndefined();
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
