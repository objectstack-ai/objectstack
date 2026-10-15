// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate resume` — what its human face says about the database once the
 * boot has run.
 *
 * Either mode's connect can switch a SQLite file's journal mode, which
 * rewrites its header and no row (measured on a rollback-journal file: header
 * bytes 18 and 19 from 1,1 to 2,2, the change counter up by one, schema and
 * rows byte-identical). So neither the list nor a declined `--run` says that
 * nothing was changed: the list claims no row or table, the abort claims no
 * row, and each names the switch on a SQLite target, and only there. The list
 * prints the same sentence on every dialect, so the base sentence is the
 * corrected one on PostgreSQL too.
 *
 * The boot is replaced by a stack over a fake engine holding one interrupted
 * run; the journal reads (`findInterruptedRuns`, `readRunJournal`) run for real
 * against it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Config } from '@oclif/core';
import { fileURLToPath } from 'node:url';
import MigrateResume from './resume.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';

const boot = vi.hoisted(() => vi.fn());
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));
// The plugins the real boot composes; the replaced boot never reads them.
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: async () => [] }));
// The `--run` confirmation, answered without a terminal: `undefined` leaves
// readline as it is.
const prompt = vi.hoisted(() => ({ answer: undefined as string | undefined }));
vi.mock('node:readline', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:readline')>();
  return {
    ...real,
    createInterface: ((...args: Parameters<typeof real.createInterface>) => (prompt.answer === undefined
      ? real.createInterface(...args)
      : { question: (_q: string, answer: (a: string) => void) => answer(prompt.answer as string), close: () => {} }
    )) as typeof real.createInterface,
  };
});

const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

// oclif reads the package's config (its whole command table) on a first run;
// it is paid here, outside the cases.
let oclifConfig: Config;
beforeAll(async () => {
  oclifConfig = await Config.load({ root: CLI_ROOT });
}, 60_000);

const SQLITE_CONFIG = { client: 'better-sqlite3', connection: { filename: '/srv/app/.objectstack/data/objectstack.db' } };
const POSTGRES_CONFIG = { client: 'pg', connection: 'postgres://db.example.com:5432/app' };

const RUN_ID = 'run_interrupted';
const PLAN_ID = 'plan.fixture';

/** A booted stack whose journal holds one interrupted run of a registered plan; `writes` records every write. */
function stackOver(config: Record<string, unknown>): { writes: string[] } {
  const writes: string[] = [];
  const journal = [
    { run_id: RUN_ID, seq: 0, kind: 'run_started', plan_hash: 'h', detail: JSON.stringify({ planId: PLAN_ID }) },
    { run_id: RUN_ID, seq: 1, kind: 'chunk_started', chunk_index: 0 },
  ];
  const engine = {
    find: async (_object: string, query: { where?: Record<string, unknown> }) =>
      journal.filter((row) =>
        Object.entries(query.where ?? {}).every(([key, value]) => (row as Record<string, unknown>)[key] === value)),
    insert: async () => { writes.push('insert'); return {}; },
    update: async () => { writes.push('update'); return {}; },
    delete: async () => { writes.push('delete'); return true; },
  };
  const plans = { get: (id: string) => (id === PLAN_ID ? { id: PLAN_ID, onCrash: 'resume' } : undefined) };
  boot.mockResolvedValue({
    driver: { config },
    kernel: {
      getService: (name: string) => (name === 'objectql' ? engine : name === 'migration-plans' ? plans : undefined),
    },
    tableAbsent: () => false,
    shutdown: async () => {},
  });
  return { writes };
}

async function runHuman(argv: string[]): Promise<string[]> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const savedExitCode = process.exitCode;
  try {
    await MigrateResume.run(argv, oclifConfig);
    return log.mock.calls.map((c) => c.map(String).join(' '));
  } finally {
    process.exitCode = savedExitCode;
    for (const spy of [log, warn, error]) spy.mockRestore();
  }
}

describe('os migrate resume — the human face names no change it cannot vouch for', () => {
  let savedIsTTY: PropertyDescriptor | undefined;
  beforeEach(() => {
    savedIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  });
  afterEach(() => {
    prompt.answer = undefined;
    boot.mockReset();
    if (savedIsTTY) Object.defineProperty(process.stdin, 'isTTY', savedIsTTY);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  });

  it('the list claims no row or table, and names the journal-mode switch on a SQLite file', async () => {
    const { writes } = stackOver(SQLITE_CONFIG);
    const lines = await runHuman([]);
    expect(writes).toEqual([]);
    expect(boot).toHaveBeenCalledWith(expect.objectContaining({ deferSchemaDdl: true, readOnlyProbe: true }));
    expect(lines.join('\n')).toContain(RUN_ID);
    const closing = lines.find((line) => line.includes('Re-run with --run'));
    expect(closing, lines.join('\n')).toContain(
      `No row or table was changed. Re-run with --run <id> to act on one. ${JOURNAL_MODE_SWITCH_NOTE}`,
    );
    expect(lines.join('\n')).not.toContain('Nothing was changed');
  }, 60_000);

  it('on a target with no file header (PostgreSQL) the list claims no row or table and names no switch', async () => {
    stackOver(POSTGRES_CONFIG);
    const lines = await runHuman([]);
    const closing = lines.find((line) => line.includes('Re-run with --run'));
    expect(closing, lines.join('\n')).toContain('No row or table was changed. Re-run with --run <id> to act on one.');
    expect(lines.join('\n')).not.toContain(JOURNAL_MODE_SWITCH_NOTE);
  }, 60_000);

  it('a --run declined at the prompt claims no row changed, and names the switch on a SQLite file', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    prompt.answer = 'n';
    const { writes } = stackOver(SQLITE_CONFIG);
    const lines = await runHuman(['--run', RUN_ID]);
    expect(writes).toEqual([]);
    const aborted = lines.find((line) => line.includes('Aborted'));
    expect(aborted, lines.join('\n')).toContain(`Aborted — no row was changed. ${JOURNAL_MODE_SWITCH_NOTE}`);
  }, 60_000);
});
