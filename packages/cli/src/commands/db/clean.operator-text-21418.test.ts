// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21418] `os db clean` prints a refused `VACUUM` through
 * `operatorFacingErrorText`, and a value bound into a raw statement reaches
 * none of what it prints.
 *
 * ## Why this file exists
 *
 * The command reaches SQLite through the driver's raw seam
 * (`driver.execute`), which declares its own fault since #16019: a composed
 * `DATABASE_ERROR` envelope with the dialect error whole under its `cause`.
 * The command's one carrier is the line it prints for a file it failed to
 * clean, and that line embeds the helper's answer. The helper used to answer
 * the `cause`'s message whole — knex's `<statement> - <diagnostic>`, which
 * inlines the statement's bound values on SQLite — so the line carried them.
 * The helper now answers through the one driver-fault cut (the maintainer's
 * ruling A on #21385, "one cutter for every log face"), and this command cuts
 * nothing of its own.
 *
 * ## What is pinned, and what is stubbed
 *
 * The REAL oclif command runs with a real argv against a real file on disk.
 * Two seams are stubbed, neither of them the mechanism under test:
 *
 *  - `@objectstack/service-datasource`'s `resolveSqliteDriver` answers a
 *    driver double whose `execute` raises the raw-path envelope, so the case
 *    needs no SQLite engine and stays in the `unit` tier. The statements the
 *    command sent are recorded, which proves the refusal came from the
 *    command's own `execute` call rather than from somewhere earlier;
 *  - `@objectstack/runtime`'s `resolveProjectDatabaseUrl` is never consulted
 *    when `--database` is passed, but the command imports the module first,
 *    and booting it here would cost the tier for nothing.
 *
 * The statements this command sends bind nothing (the census on #21418), so
 * the envelope's `cause` carries a synthetic sentinel in a synthetic bound
 * statement, printed the way knex prints one on SQLite. The envelope's shape is
 * pinned against the real producer by `driver-sql`'s
 * `sql-driver-16657-operator-facing-cause-text.test.ts`.
 *
 * ## Why the oclif `Config` is loaded at MODULE SCOPE
 *
 * The case used to hand `DbClean.run` a `{ root }`, so oclif loaded its
 * `Config` inside the clocked case. With this package built and no
 * `oclif.manifest.json`, that load imports every command module to build the
 * manifest, and it was the whole cost of the case. Measured on a shared
 * 4-vCPU container at 24db8a1c, phase timers in a throwaway copy, the busy
 * loops being CPU-bound `node` processes:
 *
 *     load              Config.load        the command's own run
 *     idle, 5 runs      3214-3681 ms       11-13 ms
 *     8 busy loops, 3   8709-9712 ms       29-57 ms
 *     24 busy loops, 3  26017-36325 ms     56-119 ms
 *
 * The case as it stood took 3427-3829 ms idle, and timed out at vitest's
 * default 5000 ms in 3 of 3 runs at 8 busy loops and 3 of 3 at 24: the CI
 * signature. The cost is LOADING, so it is paid once here, during collection,
 * which vitest clocks against nothing ("clocked windows measure behaviour,
 * never loading", AGENTS.md). ⛔ Not a hook with a bigger timeout: at 24 busy
 * loops the load alone took up to 36 s, so any budget around it is a load
 * sensor. `src/commands/datasource/envelope-unwrap.test.ts` records the same
 * measurement and the same placement for this package.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Config } from '@oclif/core';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Synthetic, and asserted ABSENT from everything the command prints. */
const SENTINEL = 'SENTINEL-21418-BOUND-VALUE';

/** `rawStatementFaultError`'s composed message, verbatim (`sql-driver.ts`). */
const COMPOSED =
  'The database refused to run a raw statement. The driver could not attribute the failure ' +
  'to any part of the request, so no verdict about the statement is claimed here. The ' +
  "backend's own diagnostic was written to the server log for an operator to read, with " +
  'the statement and its bound values cut.';

/** knex 3.3.0 + better-sqlite3: `<statement, values inlined> - <engine diagnostic>`. */
const BOUND_DIALECT_TEXT = `update "sys_setting" set "value" = '${SENTINEL}' - database is locked`;

/** The envelope the raw terminal composes, cause carrier and all. */
function rawStatementFault(): Error {
  const err = Object.assign(new Error(COMPOSED), { code: 'DATABASE_ERROR', status: 500 });
  Object.defineProperty(err, 'cause', {
    value: Object.assign(new Error(BOUND_DIALECT_TEXT), { code: 'SQLITE_BUSY' }),
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return err;
}

/**
 * The driver double's state. `vi.hoisted` because `vi.mock`'s factory is
 * hoisted above every `import` and runs while `./clean.js` is being evaluated.
 */
const stub = vi.hoisted(() => ({
  statements: [] as string[],
  thrown: undefined as unknown,
}));

vi.mock('@objectstack/service-datasource', () => ({
  resolveSqliteDriver: async () => ({
    engine: 'native',
    driver: {
      async execute(sql: string) {
        stub.statements.push(sql);
        throw stub.thrown;
      },
      async disconnect() {},
    },
  }),
}));

vi.mock('@objectstack/runtime', () => ({
  resolveProjectDatabaseUrl: () => undefined,
}));

import DbClean from './clean.js';

/** `packages/cli` — the oclif root the command is loaded against. */
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Paid HERE, at module scope and not in a hook or a case: see "Why the oclif
 * `Config` is loaded at MODULE SCOPE" in this file's header.
 */
const config = await Config.load({ root: CLI_ROOT });

/**
 * `chalk` may or may not emit SGR codes depending on TTY detection. The escape
 * is spelled as an escape, never as the byte itself.
 */
const SGR = /\x1b\[[0-9;]*m/g;

async function runClean(argv: string[]): Promise<{ out: string; exitCode: number }> {
  const chunks: string[] = [];
  const record = (...args: unknown[]) => {
    chunks.push(args.map(String).join(' '));
  };
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(record),
    vi.spyOn(console, 'warn').mockImplementation(record),
    vi.spyOn(console, 'error').mockImplementation(record),
  ];
  const savedExitCode = process.exitCode;
  let exitCode = 0;
  try {
    await DbClean.run(argv, config);
  } catch (error: unknown) {
    const oclif = (error as { oclif?: { exit?: number } })?.oclif;
    exitCode = typeof oclif?.exit === 'number' ? oclif.exit : 1;
  } finally {
    for (const spy of spies) spy.mockRestore();
    // oclif's default `catch` sets `process.exitCode`; leaving it set would
    // fail this vitest worker on a case that passed.
    process.exitCode = savedExitCode;
  }
  return { out: chunks.join('\n').replace(SGR, ''), exitCode };
}

describe('[#21418] os db clean — a refused VACUUM prints no bound value', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'os-db-clean-21418-'));
    file = path.join(dir, 'app.db');
    writeFileSync(file, '');
    stub.statements = [];
    stub.thrown = rawStatementFault();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('[the fixture] the raw path really carries the sentinel on the cause the helper reads', () => {
    const thrown = rawStatementFault();
    expect((thrown as { cause?: Error }).cause?.message).toContain(SENTINEL);
    expect(thrown.message).not.toContain(SENTINEL);
  });

  it('the failure line names the file and the dialect diagnostic, and carries no sentinel', async () => {
    const { out, exitCode } = await runClean(['--database', file]);

    // The refusal came from the command's own first statement.
    expect(stub.statements[0]).toBe('PRAGMA auto_vacuum = INCREMENTAL');
    expect(exitCode).toBe(1);
    expect(out).toContain(`VACUUM failed for ${file}`);
    expect(out).toContain('database is locked');
    expect(out).not.toContain(SENTINEL);
    expect(out).not.toContain('refused to run a raw statement');
  });
});
