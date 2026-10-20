// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24925 — `os migrate plan` never offers `--allow-destructive` for an
 * `organization_id` drop that `os migrate apply` refuses, and names the
 * organization-ownership ceremony instead (ADR-0131 D10 item 5).
 *
 * ## What used to happen
 *
 * On a 17.x database before the ceremony, the plan listed each
 * `organization_id` column 18.x no longer declares with the differ's remedy,
 * `"os migrate apply --allow-destructive" to drop it.`, and closed with
 * `(add --allow-destructive for drops / tightenings)`. That apply refuses the
 * whole run while the ceremony has not verified (the drop gate,
 * `utils/organization-ownership-drop-gate.ts`), and the plan said nothing of
 * the ceremony.
 *
 * ## What is pinned
 *
 * The plan asks the drop gate's own two functions: which entries are
 * `organization_id` drops, and whether the ceremony's marker is verified, read
 * through the stack's `objectql` service as `apply` reads it.
 *
 *  1. Unverified (no marker row, an unverified row, or no `sys_migration`
 *     table to read): each such drop is listed and counted with the ceremony
 *     as its remedy; every other entry keeps its message; the footer offers
 *     `--allow-destructive` for nothing and names the ceremony's two commands.
 *  2. CONTROL: a verified marker gives the plan as it always was.
 *  3. CONTROL: no `organization_id` drop gives the plan as it always was, and
 *     the marker is not read.
 *  4. The `--json` document is the report, unchanged, and reads no marker.
 *  5. Beside a driver's declared apply limit (`plan.apply-limit.test.ts`),
 *     both remedies hold and the limit's count excludes the held drops.
 *
 * `bootSchemaStack` is stubbed, so this runs without a database. The marker
 * read itself is the real `readOrganizationOwnershipMarker` over a fake
 * engine.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID } from '@objectstack/spec/system';

const boot = vi.hoisted(() => vi.fn(async (_opts: Record<string, unknown>): Promise<unknown> => {
  throw new Error('the database was opened');
}));
vi.mock('../../utils/schema-migrate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/schema-migrate.js')>()),
  bootSchemaStack: boot,
}));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(async () => ({ status: 'not_applicable' })),
}));

type PlanCommand = (typeof import('./plan.js'))['default'];
let MigratePlan: PlanCommand;

beforeAll(async () => {
  ({ default: MigratePlan } = await import('./plan.js'));
}, 60_000);

const CASE_TIMEOUT_MS = 60_000;
const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

afterEach(() => {
  boot.mockReset();
  boot.mockImplementation(async () => {
    throw new Error('the database was opened');
  });
});

type Entry = {
  kind: string; remoteName: string; table: string; column?: string; severity: string;
  category: 'safe' | 'needs_confirm' | 'destructive'; op: Record<string, unknown> & { type: string }; message: string;
};

/** An orphaned column as the shared differ reports it, with the message it writes. */
function orphan(table: string, column: string): Entry {
  return {
    kind: 'unmapped_column', remoteName: table, table, column, severity: 'warning', category: 'destructive',
    op: { type: 'drop_column', table, column },
    message: `${table}.${column}: column exists in the database but not in metadata (orphaned) — "os migrate apply --allow-destructive" to drop it.`,
  };
}

/** Two `organization_id` drops a 17.x database carries before the ceremony. */
const ORG_JOB = orphan('sys_job', 'organization_id');
const ORG_SECRET = orphan('sys_secret', 'organization_id');
/** A destructive drop the ceremony does not own. */
const LEGACY = orphan('sys_sso_provider', 'created_by');
/** A safe entry, which `os migrate apply` performs without --allow-destructive. */
const INDEX: Entry = {
  kind: 'missing_index', remoteName: 'sys_job', table: 'sys_job', severity: 'info', category: 'safe',
  op: { type: 'create_index', table: 'sys_job', createIndexName: 'idx_sys_job_created_at' },
  message: `sys_job: metadata declares index 'idx_sys_job_created_at' (created_at) but the database has no such index — run "os migrate apply" to create it.`,
};
/** A tightening a Turso REMOTE driver declares it cannot apply. */
const TIGHTEN: Entry = {
  kind: 'nullability_mismatch', remoteName: 't', table: 't', column: 'code', severity: 'error', category: 'destructive',
  op: { type: 'tighten_not_null', table: 't', column: 'code' },
  message: 't.code: metadata declares `storage.notNull` but the column is nullable — existing nulls must be backfilled. Run "os migrate apply --allow-destructive".',
};
const LIMIT = 'it needs the SQLite table rebuild, which the Turso REMOTE transport does not run';

/** The line each held drop is listed with: the finding, then the ceremony. */
const heldLine = (e: Entry) =>
  `        ${e.table}.${e.column}: column exists in the database but not in metadata (orphaned) — a drop the `
  + 'organization-ownership ceremony owns, and it has not verified on this database: the ceremony drops it itself (see below).';

const CEREMONY_STEPS =
  'Run "os migrate organization-ownership --out PLAN" to write and review its plan, take a backup, then '
  + '"os migrate organization-ownership --apply --plan-file PLAN --backup-taken"; it drops these columns itself.';

const now = '2026-10-20T00:00:00.000Z';
/** The ceremony's `sys_migration` row as `readDataMigrationFlag` reads it. */
const VERIFIED = { id: ORGANIZATION_OWNERSHIP_MIGRATION_ID, last_run_at: now, verified_at: now, blocking: 0 };
const UNVERIFIED = { id: ORGANIZATION_OWNERSHIP_MIGRATION_ID, last_run_at: now, verified_at: null, blocking: 2 };

/**
 * The `objectql` service as the marker read meets it: `sys_migration` is
 * registered, and the row read answers `row` (or throws it, as a read of a
 * table the database does not have does).
 */
function engineAnswering(row: Record<string, unknown> | null | Error) {
  return {
    getObject: (name: string) => (name === 'sys_migration' ? { name } : undefined),
    findOne: vi.fn(async (object: string, options: { where?: { id?: string } }) => {
      expect(object).toBe('sys_migration');
      expect(options.where?.id).toBe(ORGANIZATION_OWNERSHIP_MIGRATION_ID);
      if (row instanceof Error) throw row;
      return row;
    }),
  };
}

/** A booted stack as `bootSchemaStack` answers it, its kernel serving `engine` as `objectql`. */
function stackWith(
  drift: Entry[],
  engine: ReturnType<typeof engineAnswering>,
  opts: { limited?: ReadonlySet<string>; pending?: unknown[] } = {},
) {
  const getService = vi.fn((name: string) => {
    if (name === 'objectql') return engine;
    throw new Error(`no ${name} service in this pin`);
  });
  return {
    getService,
    stack: {
      driver: { config: { url: 'postgres://db.example/app' } },
      dbLabel: 'postgres://db.example/app',
      dbSource: { kind: 'flag' },
      schemaSync: 'deferred',
      telemetryDatabase: null,
      drivers: [],
      detectManagedDrift: vi.fn(async () => drift),
      driftApplyLimit: (e: Entry): string | null => (opts.limited?.has(e.op.type) ? LIMIT : null),
      applyMigrationEntries: vi.fn(async () => { throw new Error('a plan applies nothing'); }),
      pendingSchemaWork: opts.pending ?? [],
      flushSchemaDdl: vi.fn(async () => { throw new Error('a plan creates nothing'); }),
      managedTableCount: 3,
      kernel: { getService },
      tableAbsent: () => false,
      allObjects: () => [],
      composition: {
        plugins: [], hostConfigPath: null, hostConfigLoaded: false, hostConfigError: null,
        servedBoot: { mirrored: false, reason: 'not-composed' }, notes: [], coverage: null,
      },
      shutdown: async () => {},
    },
  };
}

/** The real command, with its output captured: the JSON document, or the human lines. */
async function run(argv: string[]): Promise<{ payload: any; lines: string[]; exitCode: number }> {
  const chunks: string[] = [];
  const said: string[] = [];
  const savedExit = process.exitCode;
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write);
  // Its callback runs too, or the command's exit waits out its drain timeout
  // (`utils/one-shot-exit.ts`) on every case.
  vi.spyOn(process.stderr, 'write').mockImplementation(((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stderr.write);
  const capture = (...parts: unknown[]) => { said.push(parts.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  let thrownExit: number | undefined;
  try {
    await MigratePlan.run(argv, { root: CLI_ROOT });
  } catch (error) {
    const oclif = (error as { oclif?: { exit?: number } }).oclif;
    const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
    if (oclif === undefined && !trapped) throw error;
    if (oclif) thrownExit = oclif.exit;
  }
  const exitCode = processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0;
  process.exitCode = savedExit;
  vi.restoreAllMocks();
  const out = chunks.join('').trim();
  return {
    payload: argv.includes('--json') ? JSON.parse(out) : null,
    lines: said.join('\n').split('\n'),
    exitCode,
  };
}

/** The line the plan prints under an entry's heading: its finding and its remedy. */
function entryLine(lines: string[], target: string): string {
  const at = lines.findIndex((l) => l.includes(` ${target} [`));
  expect(at, `no ${target} entry in:\n${lines.join('\n')}`).toBeGreaterThanOrEqual(0);
  return lines[at + 1]!;
}

/** Everything the plan prints below its summary line, but the blank lines and its timer: the footer. */
function footer(lines: string[]): string[] {
  const at = lines.findIndex((l) => /\d+ change\(s\): \d+ safe/.test(l));
  expect(at, lines.join('\n')).toBeGreaterThanOrEqual(0);
  return lines.slice(at + 1).filter((l) => l.trim() !== '' && !/^\s+\d+ms$/.test(l));
}

describe('a database the organization-ownership ceremony has not verified', () => {
  it('each organization_id drop names the ceremony, never --allow-destructive; the footer offers --allow-destructive for nothing and names both ceremony commands', async () => {
    const engine = engineAnswering(null);
    const { stack, getService } = stackWith([INDEX, ORG_JOB, LEGACY, ORG_SECRET], engine);
    boot.mockResolvedValueOnce(stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);

    expect(entryLine(lines, 'sys_job.organization_id')).toBe(heldLine(ORG_JOB));
    expect(entryLine(lines, 'sys_secret.organization_id')).toBe(heldLine(ORG_SECRET));
    // The ceremony does not own this drop: it keeps the differ's message.
    expect(entryLine(lines, 'sys_sso_provider.created_by')).toBe(`        ${LEGACY.message}`);
    expect(entryLine(lines, 'sys_job [idx_sys_job_created_at]')).toBe(`        ${INDEX.message}`);
    // Still drift: listed and counted, never dropped from the plan.
    expect(lines.join('\n')).toContain('4 change(s): 1 safe, 0 needs-confirm, 3 destructive');

    expect(footer(lines)).toEqual([
      '  Apply with: os migrate apply',
      '  ⚠ 2 organization_id drop(s) above are the organization-ownership ceremony\'s, and it has not verified on this '
        + 'database, so "os migrate apply --allow-destructive" refuses every run until it has (the other 1 destructive '
        + `change(s) above wait for it too). ${CEREMONY_STEPS}`,
    ]);
    // Asked once, of the service `apply`'s drop gate asks.
    expect(getService.mock.calls).toEqual([['objectql']]);
    expect(engine.findOne).toHaveBeenCalledTimes(1);
  }, CASE_TIMEOUT_MS);

  it('when apply can perform nothing listed until the ceremony, there is no apply line, only the ceremony', async () => {
    boot.mockResolvedValueOnce(stackWith([ORG_JOB], engineAnswering(null)).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(entryLine(lines, 'sys_job.organization_id')).toBe(heldLine(ORG_JOB));
    expect(footer(lines)).toEqual([
      '  ⚠ 1 organization_id drop(s) above are the organization-ownership ceremony\'s, and it has not verified on this '
        + `database, so "os migrate apply --allow-destructive" refuses every run until it has. ${CEREMONY_STEPS}`,
    ]);
  }, CASE_TIMEOUT_MS);

  it('an unverified marker row holds the drops too', async () => {
    boot.mockResolvedValueOnce(stackWith([ORG_JOB, LEGACY], engineAnswering(UNVERIFIED)).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(entryLine(lines, 'sys_job.organization_id')).toBe(heldLine(ORG_JOB));
    expect(lines.join('\n')).not.toContain('(add --allow-destructive');
    expect(lines.join('\n')).toContain('1 organization_id drop(s) above are the organization-ownership ceremony\'s');
  }, CASE_TIMEOUT_MS);

  it('a database with no sys_migration table to read answers "not verified": the read fails, the plan does not', async () => {
    const engine = engineAnswering(new Error('SQLITE_ERROR: no such table: sys_migration'));
    boot.mockResolvedValueOnce(stackWith([ORG_JOB], engine).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(engine.findOne).toHaveBeenCalledTimes(1);
    expect(entryLine(lines, 'sys_job.organization_id')).toBe(heldLine(ORG_JOB));
    expect(footer(lines).join('\n')).toContain(CEREMONY_STEPS);
  }, CASE_TIMEOUT_MS);

  it('--json: the document is the report, unchanged — each message as the differ wrote it, and no marker is read', async () => {
    const { stack, getService } = stackWith([INDEX, ORG_JOB, LEGACY], engineAnswering(null));
    boot.mockResolvedValueOnce(stack);
    const { payload, exitCode } = await run(['--json']);
    expect(exitCode).toBe(0);
    expect(Object.keys(payload).sort()).toEqual(
      ['changes', 'database', 'databaseSource', 'duration', 'managedTables', 'pending', 'total', 'unmanagedTables'],
    );
    expect(payload.changes.map((c: Entry) => c.message)).toEqual([INDEX.message, ORG_JOB.message, LEGACY.message]);
    expect(getService).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);

  it('beside a driver\'s declared apply limit, each keeps its own remedy, and the limit\'s count is its own', async () => {
    const drift = [ORG_JOB, TIGHTEN, INDEX];
    boot.mockResolvedValueOnce(stackWith(drift, engineAnswering(null), { limited: new Set(['tighten_not_null']) }).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(entryLine(lines, 'sys_job.organization_id')).toBe(heldLine(ORG_JOB));
    expect(entryLine(lines, 't.code')).toContain(`"os migrate apply" cannot apply it on this database: ${LIMIT}.`);
    expect(entryLine(lines, 't.code')).not.toContain('--allow-destructive');
    expect(footer(lines)).toEqual([
      '  Apply with: os migrate apply',
      '  ⚠ 1 organization_id drop(s) above are the organization-ownership ceremony\'s, and it has not verified on this '
        + `database, so "os migrate apply --allow-destructive" refuses every run until it has. ${CEREMONY_STEPS}`,
      '  ⚠ 1 change(s) above cannot be applied on this database by "os migrate apply" (each says why), so they '
        + 'remain drift after it runs.',
    ]);
  }, CASE_TIMEOUT_MS);
});

describe('CONTROL: the plan as it always was', () => {
  /** What the plan prints for `drift` when nothing holds an entry back: each message, and the one footer. */
  function expectTodaysPlan(lines: string[], drift: Entry[]): void {
    for (const e of drift) {
      const target = e.column ? `${e.table}.${e.column}` : `${e.table} [${String(e.op.createIndexName)}]`;
      expect(entryLine(lines, target)).toBe(`        ${e.message}`);
    }
    expect(lines.join('\n')).not.toContain('organization-ownership');
    expect(footer(lines)).toEqual(['  Apply with: os migrate apply (add --allow-destructive for drops / tightenings)']);
  }

  it('a verified ceremony: every organization_id drop keeps its message, and the footer is the one it always was', async () => {
    const engine = engineAnswering(VERIFIED);
    boot.mockResolvedValueOnce(stackWith([INDEX, ORG_JOB, LEGACY, ORG_SECRET], engine).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(engine.findOne).toHaveBeenCalledTimes(1);
    expectTodaysPlan(lines, [INDEX, ORG_JOB, LEGACY, ORG_SECRET]);
  }, CASE_TIMEOUT_MS);

  it('no organization_id drop: the plan is the one it always was, and the marker is never read', async () => {
    const { stack, getService } = stackWith([INDEX, LEGACY], engineAnswering(null));
    boot.mockResolvedValueOnce(stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(getService).not.toHaveBeenCalled();
    expectTodaysPlan(lines, [INDEX, LEGACY]);
  }, CASE_TIMEOUT_MS);
});
