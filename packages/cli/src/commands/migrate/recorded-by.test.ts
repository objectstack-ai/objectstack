// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate recorded-by` command shape (#4556).
 *
 * The conversion itself is proven against the real journal runner in
 * `@objectstack/metadata-protocol`'s `migrations/recorded-by-sentinel.test.ts`.
 * What is pinned here is the thing a unit test of the plan cannot see: that
 * this subcommand honours #2186 — a bare `os migrate <topic>` must never
 * mutate the database by surprise, so writing is opt-in behind `--apply`.
 *
 * And what its human face says about the database once the boot has run.
 * Either mode's connect can switch a SQLite file's journal mode, which
 * rewrites its header and no row, so neither the dry run nor a declined
 * `--apply` says that nothing was changed; each names the switch on a SQLite
 * target, and only there. The boot is replaced by a stack over a fake engine.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import MigrateRecordedBy from './recorded-by.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import {
  RECORDED_BY_SENTINEL,
  RECORDED_BY_SENTINEL_PLAN_ID,
  createRecordedBySentinelPlan,
} from '@objectstack/metadata-protocol';

const boot = vi.hoisted(() => vi.fn());
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));
// The plugins the real boot composes; the replaced boot never reads them.
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: async () => [] }));
// The `--apply` confirmation, answered without a terminal: `undefined` leaves
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

describe('os migrate recorded-by', () => {
  it('is a dry run by default — --apply is opt-in (#2186)', () => {
    expect(MigrateRecordedBy.flags.apply.default).toBe(false);
  });

  it('requires explicit confirmation to write — --yes is opt-in', () => {
    expect(MigrateRecordedBy.flags.yes.default).toBe(false);
  });

  it('describes what it converts, so `os migrate --help` is self-explanatory', () => {
    expect(MigrateRecordedBy.description).toContain('recorded_by');
    expect(MigrateRecordedBy.description).toContain('NULL');
  });

  it('drives the plan the metadata package owns — no second copy of the conversion', () => {
    const plan = createRecordedBySentinelPlan();
    expect(plan.id).toBe(RECORDED_BY_SENTINEL_PLAN_ID);
    // A rediscovered run goes FORWARD: unwinding would put the fake foreign
    // key back, which is the thing this plan exists to remove.
    expect(plan.onCrash).toBe('resume');
    expect(RECORDED_BY_SENTINEL).toBe('system');
  });
});

const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SQLITE_CONFIG = { client: 'better-sqlite3', connection: { filename: '/srv/app/.objectstack/data/objectstack.db' } };
const POSTGRES_CONFIG = { client: 'pg', connection: 'postgres://db.example.com:5432/app' };

/** A booted stack over one history row holding the sentinel; `writes` records every write the engine took. */
function stackOver(config: Record<string, unknown>): { writes: string[] } {
  const writes: string[] = [];
  const rows = [{ id: 'h_sentinel', recorded_by: RECORDED_BY_SENTINEL }];
  const engine = {
    find: async (_object: string, query: { where?: { recorded_by?: unknown } }) =>
      rows.filter((r) => r.recorded_by === query.where?.recorded_by).map((r) => ({ id: r.id })),
    insert: async () => { writes.push('insert'); return {}; },
    update: async () => { writes.push('update'); return {}; },
    delete: async () => { writes.push('delete'); return true; },
  };
  boot.mockResolvedValue({
    driver: { config },
    kernel: { getService: (name: string) => (name === 'objectql' ? engine : undefined) },
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
    await MigrateRecordedBy.run(argv, { root: CLI_ROOT });
    return log.mock.calls.map((c) => c.map(String).join(' '));
  } finally {
    process.exitCode = savedExitCode;
    for (const spy of [log, warn, error]) spy.mockRestore();
  }
}

describe('os migrate recorded-by — the human face names no change it cannot vouch for', () => {
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

  it('the dry run claims no row or table, and names the journal-mode switch on a SQLite file', async () => {
    const { writes } = stackOver(SQLITE_CONFIG);
    const lines = await runHuman([]);
    expect(writes).toEqual([]);
    expect(boot).toHaveBeenCalledWith(expect.objectContaining({ deferSchemaDdl: true, readOnlyProbe: true }));
    const closing = lines.find((line) => line.includes('Re-run with --apply'));
    expect(closing, lines.join('\n')).toContain(
      `No row or table was changed. Re-run with --apply to rewrite them to NULL. ${JOURNAL_MODE_SWITCH_NOTE}`,
    );
    expect(lines.join('\n')).not.toContain('Nothing was changed');
  }, 60_000);

  it('on a target with no file header (PostgreSQL) the dry run claims no row or table and names no switch', async () => {
    stackOver(POSTGRES_CONFIG);
    const lines = await runHuman([]);
    const closing = lines.find((line) => line.includes('Re-run with --apply'));
    expect(closing, lines.join('\n')).toContain('No row or table was changed. Re-run with --apply to rewrite them to NULL.');
    expect(lines.join('\n')).not.toContain(JOURNAL_MODE_SWITCH_NOTE);
  }, 60_000);

  it('an --apply declined at the prompt claims no row changed, and names the switch on a SQLite file', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    prompt.answer = 'n';
    const { writes } = stackOver(SQLITE_CONFIG);
    const lines = await runHuman(['--apply']);
    expect(writes).toEqual([]);
    const aborted = lines.find((line) => line.includes('Aborted'));
    expect(aborted, lines.join('\n')).toContain(`Aborted — no row was changed. ${JOURNAL_MODE_SWITCH_NOTE}`);
  }, 60_000);
});
