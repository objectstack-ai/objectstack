// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23925 — `os migrate plan` reads, from the driver that reported each drift
 * entry, whether `os migrate apply` can perform it on that database, and never
 * offers a remedy the database does not have.
 *
 * ## What used to happen
 *
 * On a Turso REMOTE primary the plan listed a `tighten_not_null` with the
 * shared differ's remedy, `Run "os migrate apply --allow-destructive".`, and
 * closed with `(add --allow-destructive for drops / tightenings)`. That
 * transport runs no SQLite table rebuild, so the apply then named the entry as
 * not applied and exited 1 (PARTIAL).
 *
 * ## What is pinned
 *
 * The plan asks `SchemaStack.driftApplyLimit` (the reporting driver's
 * declaration) for each entry, and never the dialect or the URL:
 *
 *  1. An entry whose driver declares a limit is listed with its finding and
 *     that limit, without the `--allow-destructive` remedy. An entry with no
 *     limit (here the `drop_column`) keeps its message as the differ wrote it.
 *  2. The footer offers `--allow-destructive` only for a destructive entry the
 *     database can apply, and names how many listed entries it cannot.
 *  3. CONTROL: a driver that declares nothing reads exactly as before.
 *  4. The `--json` document is the report, unchanged: the same keys, and each
 *     entry's message as the differ wrote it.
 *
 * `bootSchemaStack` is stubbed, so this runs without a database; the same
 * cases run against a real `sqld` in `apply.remote-face.integration.test.ts`.
 *
 * ## #24925 — a drop `apply` refuses: the ceremony's `organization_id` drops
 *
 * On a 17.x database before the organization-ownership ceremony, the plan
 * listed each `organization_id` column 18.x no longer declares with the
 * differ's `--allow-destructive` remedy and the same footer, while `os migrate
 * apply` refuses the whole `--allow-destructive` run until the ceremony has
 * verified (`utils/organization-ownership-drop-gate.ts`, ADR-0131 D10 item 5).
 * The plan asks the drop gate's own two functions, through the stack's
 * `objectql` service as `apply` does:
 *
 *  5. Unverified (no marker row, an unverified row, or no `sys_migration`
 *     table to read): each such drop is listed and counted with the ceremony
 *     as its remedy, every other entry keeps its message, and the footer offers
 *     `--allow-destructive` for nothing and names the ceremony's two commands.
 *     Beside a driver's declared limit, each keeps its own remedy.
 *  6. CONTROL: a verified marker, or no `organization_id` drop, gives the plan
 *     as it always was; with no such drop the marker is not even read.
 *  7. The `--json` document is unchanged and reads no marker.
 *
 * The marker read is the real `readOrganizationOwnershipMarker` over a fake
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

const T = 't23925';

/** The three entries a remote primary reports here, each with the message the shared differ writes. */
const DROP: Entry = {
  kind: 'unmapped_column', remoteName: T, table: T, column: 'legacy', severity: 'warning', category: 'destructive',
  op: { type: 'drop_column', table: T, column: 'legacy' },
  message: `${T}.legacy: column exists in the database but not in metadata (orphaned) — "os migrate apply --allow-destructive" to drop it.`,
};
const TIGHTEN: Entry = {
  kind: 'nullability_mismatch', remoteName: T, table: T, column: 'code', severity: 'error', category: 'destructive',
  op: { type: 'tighten_not_null', table: T, column: 'code' },
  message: `${T}.code: metadata declares \`storage.notNull\` but the column is nullable — existing nulls must be backfilled. Run "os migrate apply --allow-destructive".`,
};
const RELAX: Entry = {
  kind: 'nullability_mismatch', remoteName: T, table: T, column: 'memo', severity: 'warning', category: 'needs_confirm',
  op: { type: 'relax_not_null', table: T, column: 'memo' },
  message: `${T}.memo: the column is NOT NULL but the metadata declares no storage constraint. Ratify it by declaring \`storage: { notNull: true }\` yourself — nothing supplies it for you, and \`required: true\` does not imply it (ADR-0113) — or deliberately relax the column via "os migrate".`,
};

/** What a driver declares for an op its apply door cannot perform (the REMOTE face's sentence). */
const LIMIT = 'it needs the SQLite table rebuild, which the Turso REMOTE transport does not run';

/**
 * A booted stack as `bootSchemaStack` answers it. `limited` names the op types
 * the reporting driver declares it cannot apply; an empty set is a driver that
 * declares nothing.
 */
function stackWith(drift: Entry[], limited: ReadonlySet<string>) {
  const driftApplyLimit = vi.fn((e: Entry): string | null => (limited.has(e.op.type) ? LIMIT : null));
  return {
    driftApplyLimit,
    stack: {
      driver: { config: { url: 'libsql://tenant.example' } },
      dbLabel: 'libsql://tenant.example',
      dbSource: { kind: 'flag' },
      schemaSync: 'skipped',
      telemetryDatabase: null,
      drivers: [],
      detectManagedDrift: vi.fn(async () => drift),
      driftApplyLimit,
      applyMigrationEntries: vi.fn(async () => { throw new Error('a plan applies nothing'); }),
      pendingSchemaWork: [],
      flushSchemaDdl: vi.fn(async () => { throw new Error('a plan creates nothing'); }),
      managedTableCount: 1,
      kernel: { getService: () => { throw new Error('no kernel in this pin'); } },
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
  // (`utils/one-shot-exit.ts`, 2 s) on every case.
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

/** The line the plan prints under an entry's `[op]` heading: its finding and its remedy. */
function entryLine(lines: string[], op: string): string {
  const at = lines.findIndex((l) => l.includes(`[${op}]`));
  expect(at, `no [${op}] entry in:\n${lines.join('\n')}`).toBeGreaterThanOrEqual(0);
  return lines[at + 1]!;
}

const footer = (lines: string[]) => lines.filter((l) => /Apply with:|cannot be applied on this database/.test(l));

describe('a driver that declares what its apply door cannot perform', () => {
  it('each such entry names that limit instead of --allow-destructive; the drop keeps its remedy; the footer offers --allow-destructive for the drop alone', async () => {
    const { stack, driftApplyLimit } = stackWith([DROP, TIGHTEN, RELAX], new Set(['tighten_not_null', 'relax_not_null']));
    boot.mockResolvedValueOnce(stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);

    const tighten = entryLine(lines, 'tighten_not_null');
    expect(tighten).not.toContain('--allow-destructive');
    expect(tighten).toContain(
      `${T}.code: metadata declares \`storage.notNull\` but the column is nullable — existing nulls must be backfilled. `
      + `"os migrate apply" cannot apply it on this database: ${LIMIT}.`,
    );
    expect(entryLine(lines, 'relax_not_null')).toContain(`"os migrate apply" cannot apply it on this database: ${LIMIT}.`);
    expect(entryLine(lines, 'drop_column')).toContain(DROP.message);
    expect(entryLine(lines, 'drop_column')).not.toContain('cannot apply it on this database');

    const tail = footer(lines);
    expect(tail.join('\n')).not.toContain('(add --allow-destructive for drops / tightenings)');
    expect(tail.join('\n')).toContain('Apply with: os migrate apply (add --allow-destructive for the 1 destructive change(s) it can apply on this database)');
    expect(tail.join('\n')).toMatch(/2 change\(s\) above cannot be applied on this database by "os migrate apply"/);
    // Asked once per entry, of the stack that knows which driver reported it.
    expect(driftApplyLimit).toHaveBeenCalledTimes(3);
  }, CASE_TIMEOUT_MS);

  it('when it can apply none of them, the plan offers no apply at all, and never --allow-destructive for the tightening', async () => {
    boot.mockResolvedValueOnce(stackWith([TIGHTEN], new Set(['tighten_not_null'])).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(entryLine(lines, 'tighten_not_null')).not.toContain('--allow-destructive');
    const tail = footer(lines);
    expect(tail.join('\n')).not.toContain('Apply with:');
    expect(tail.join('\n')).toMatch(/1 change\(s\) above cannot be applied on this database by "os migrate apply"/);
    // Still drift: the entry is listed and counted, never dropped from the plan.
    expect(lines.join('\n')).toContain('1 change(s): 0 safe, 0 needs-confirm, 1 destructive');
  }, CASE_TIMEOUT_MS);

  it('--json: the document is the report, unchanged — the same keys, each message as the differ wrote it', async () => {
    boot.mockResolvedValueOnce(stackWith([DROP, TIGHTEN, RELAX], new Set(['tighten_not_null', 'relax_not_null'])).stack);
    const { payload, exitCode } = await run(['--json']);
    expect(exitCode).toBe(0);
    expect(Object.keys(payload).sort()).toEqual(
      ['changes', 'database', 'databaseSource', 'duration', 'managedTables', 'pending', 'schemaSync', 'total', 'unmanagedTables'],
    );
    expect(payload.changes.map((c: Entry) => c.message)).toEqual([DROP.message, TIGHTEN.message, RELAX.message]);
  }, CASE_TIMEOUT_MS);
});

describe('CONTROL: a driver that declares nothing reads exactly as before', () => {
  it('every entry keeps its message, and the footer is the one it always was', async () => {
    boot.mockResolvedValueOnce(stackWith([DROP, TIGHTEN, RELAX], new Set()).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(entryLine(lines, 'tighten_not_null')).toBe(`        ${TIGHTEN.message}`);
    expect(entryLine(lines, 'relax_not_null')).toBe(`        ${RELAX.message}`);
    expect(entryLine(lines, 'drop_column')).toBe(`        ${DROP.message}`);
    expect(footer(lines)).toEqual(['  Apply with: os migrate apply (add --allow-destructive for drops / tightenings)']);
  }, CASE_TIMEOUT_MS);
});

// ── #24925: the organization-ownership ceremony's organization_id drops ──────

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

/** The line each held drop is listed with: the finding, then the ceremony. */
const heldLine = (e: Entry) =>
  `        ${e.table}.${e.column}: column exists in the database but not in metadata (orphaned) — a drop the `
  + 'organization-ownership ceremony owns, and it has not verified on this database: the ceremony drops it itself (see below).';

const CEREMONY_STEPS =
  'Run "os migrate organization-ownership --out PLAN" to write and review its plan, take a backup, then '
  + '"os migrate organization-ownership --apply --plan-file PLAN --backup-taken"; it drops these columns itself.';
const ceremonyLine = (drops: number, waiting: number) =>
  `  ⚠ ${drops} organization_id drop(s) above are the organization-ownership ceremony's, and it has not verified on `
  + 'this database, so "os migrate apply --allow-destructive" refuses every run until it has'
  + (waiting > 0 ? ` (the other ${waiting} destructive change(s) above wait for it too)` : '')
  + `. ${CEREMONY_STEPS}`;

const MARKED_AT = '2026-10-20T00:00:00.000Z';
/** The ceremony's `sys_migration` row as `readDataMigrationFlag` reads it. */
const VERIFIED = { id: ORGANIZATION_OWNERSHIP_MIGRATION_ID, last_run_at: MARKED_AT, verified_at: MARKED_AT, blocking: 0 };
const UNVERIFIED = { id: ORGANIZATION_OWNERSHIP_MIGRATION_ID, last_run_at: MARKED_AT, verified_at: null, blocking: 2 };

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

/** A booted local stack whose kernel serves `engine` as `objectql`; `limited` as {@link stackWith}'s. */
function ceremonyStackWith(
  drift: Entry[],
  engine: ReturnType<typeof engineAnswering>,
  limited: ReadonlySet<string> = new Set(),
) {
  const getService = vi.fn((name: string) => {
    if (name === 'objectql') return engine;
    throw new Error(`no ${name} service in this pin`);
  });
  const { stack } = stackWith(drift, limited);
  return {
    getService,
    stack: {
      ...stack,
      driver: { config: { url: 'postgres://db.example/app' } },
      dbLabel: 'postgres://db.example/app',
      schemaSync: 'deferred',
      kernel: { getService },
    },
  };
}

/** The line the plan prints under the entry acting on `target`: its finding and its remedy. */
function lineUnder(lines: string[], target: string): string {
  const at = lines.findIndex((l) => l.includes(` ${target} [`));
  expect(at, `no ${target} entry in:\n${lines.join('\n')}`).toBeGreaterThanOrEqual(0);
  return lines[at + 1]!;
}

/** Everything the plan prints below its summary line, but the blank lines and its timer. */
function footerUnder(lines: string[]): string[] {
  const at = lines.findIndex((l) => /\d+ change\(s\): \d+ safe/.test(l));
  expect(at, lines.join('\n')).toBeGreaterThanOrEqual(0);
  return lines.slice(at + 1).filter((l) => l.trim() !== '' && !/^\s+\d+ms$/.test(l));
}

describe('#24925 — a database the organization-ownership ceremony has not verified', () => {
  it('each organization_id drop names the ceremony, never --allow-destructive; the footer offers --allow-destructive for nothing and names both ceremony commands', async () => {
    const engine = engineAnswering(null);
    const { stack, getService } = ceremonyStackWith([INDEX, ORG_JOB, LEGACY, ORG_SECRET], engine);
    boot.mockResolvedValueOnce(stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);

    expect(lineUnder(lines, 'sys_job.organization_id')).toBe(heldLine(ORG_JOB));
    expect(lineUnder(lines, 'sys_secret.organization_id')).toBe(heldLine(ORG_SECRET));
    // The ceremony does not own this drop: it keeps the differ's message.
    expect(lineUnder(lines, 'sys_sso_provider.created_by')).toBe(`        ${LEGACY.message}`);
    expect(lineUnder(lines, 'sys_job [idx_sys_job_created_at]')).toBe(`        ${INDEX.message}`);
    // Still drift: listed and counted, never dropped from the plan.
    expect(lines.join('\n')).toContain('4 change(s): 1 safe, 0 needs-confirm, 3 destructive');

    expect(footerUnder(lines)).toEqual(['  Apply with: os migrate apply', ceremonyLine(2, 1)]);
    // Asked once, of the service `apply`'s drop gate asks.
    expect(getService.mock.calls).toEqual([['objectql']]);
    expect(engine.findOne).toHaveBeenCalledTimes(1);
  }, CASE_TIMEOUT_MS);

  it('when apply can perform nothing listed before the ceremony, there is no apply line, only the ceremony', async () => {
    boot.mockResolvedValueOnce(ceremonyStackWith([ORG_JOB], engineAnswering(null)).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(lineUnder(lines, 'sys_job.organization_id')).toBe(heldLine(ORG_JOB));
    expect(footerUnder(lines)).toEqual([ceremonyLine(1, 0)]);
  }, CASE_TIMEOUT_MS);

  it('an unverified marker row holds the drops too', async () => {
    boot.mockResolvedValueOnce(ceremonyStackWith([ORG_JOB, LEGACY], engineAnswering(UNVERIFIED)).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(lineUnder(lines, 'sys_job.organization_id')).toBe(heldLine(ORG_JOB));
    expect(footerUnder(lines)).toEqual([ceremonyLine(1, 1)]);
  }, CASE_TIMEOUT_MS);

  it('a database with no sys_migration table to read answers "not verified": the read fails, the plan does not', async () => {
    const engine = engineAnswering(new Error('SQLITE_ERROR: no such table: sys_migration'));
    boot.mockResolvedValueOnce(ceremonyStackWith([ORG_JOB], engine).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(engine.findOne).toHaveBeenCalledTimes(1);
    expect(lineUnder(lines, 'sys_job.organization_id')).toBe(heldLine(ORG_JOB));
    expect(footerUnder(lines)).toEqual([ceremonyLine(1, 0)]);
  }, CASE_TIMEOUT_MS);

  it('beside a driver\'s declared apply limit, each keeps its own remedy, and the limit\'s count is its own', async () => {
    boot.mockResolvedValueOnce(
      ceremonyStackWith([ORG_JOB, TIGHTEN, INDEX], engineAnswering(null), new Set(['tighten_not_null'])).stack,
    );
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(lineUnder(lines, 'sys_job.organization_id')).toBe(heldLine(ORG_JOB));
    expect(entryLine(lines, 'tighten_not_null')).toContain(`"os migrate apply" cannot apply it on this database: ${LIMIT}.`);
    expect(entryLine(lines, 'tighten_not_null')).not.toContain('--allow-destructive');
    expect(footerUnder(lines)).toEqual([
      '  Apply with: os migrate apply',
      ceremonyLine(1, 0),
      '  ⚠ 1 change(s) above cannot be applied on this database by "os migrate apply" (each says why), so they '
        + 'remain drift after it runs.',
    ]);
  }, CASE_TIMEOUT_MS);

  it('--json: the document is the report, unchanged — each message as the differ wrote it, and no marker is read', async () => {
    const { stack, getService } = ceremonyStackWith([INDEX, ORG_JOB, LEGACY], engineAnswering(null));
    boot.mockResolvedValueOnce(stack);
    const { payload, exitCode } = await run(['--json']);
    expect(exitCode).toBe(0);
    expect(Object.keys(payload).sort()).toEqual(
      ['changes', 'database', 'databaseSource', 'duration', 'managedTables', 'pending', 'total', 'unmanagedTables'],
    );
    expect(payload.changes.map((c: Entry) => c.message)).toEqual([INDEX.message, ORG_JOB.message, LEGACY.message]);
    expect(getService).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);
});

describe('#24925 CONTROL: the plan as it always was', () => {
  /** What the plan prints for `drift` when nothing holds an entry back: each message, and the one footer. */
  function expectTodaysPlan(lines: string[], drift: Entry[]): void {
    for (const e of drift) {
      const target = e.column ? `${e.table}.${e.column}` : `${e.table} [${String(e.op.createIndexName)}]`;
      expect(lineUnder(lines, target)).toBe(`        ${e.message}`);
    }
    expect(lines.join('\n')).not.toContain('organization-ownership');
    expect(footerUnder(lines)).toEqual(['  Apply with: os migrate apply (add --allow-destructive for drops / tightenings)']);
  }

  it('a verified ceremony: every organization_id drop keeps its message, and the footer is the one it always was', async () => {
    const engine = engineAnswering(VERIFIED);
    boot.mockResolvedValueOnce(ceremonyStackWith([INDEX, ORG_JOB, LEGACY, ORG_SECRET], engine).stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expectTodaysPlan(lines, [INDEX, ORG_JOB, LEGACY, ORG_SECRET]);
    // …and the marker WAS read: this control is not passing for want of a read.
    expect(engine.findOne).toHaveBeenCalledTimes(1);
  }, CASE_TIMEOUT_MS);

  it('no organization_id drop: the plan is the one it always was, and the marker is never read', async () => {
    const { stack, getService } = ceremonyStackWith([INDEX, LEGACY], engineAnswering(null));
    boot.mockResolvedValueOnce(stack);
    const { lines, exitCode } = await run([]);
    expect(exitCode, lines.join('\n')).toBe(0);
    expect(getService).not.toHaveBeenCalled();
    expectTodaysPlan(lines, [INDEX, LEGACY]);
  }, CASE_TIMEOUT_MS);
});
