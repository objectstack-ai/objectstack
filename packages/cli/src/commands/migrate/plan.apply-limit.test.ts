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
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

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
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
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
