// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23848 — `os migrate plan` and `os migrate apply` on a primary whose
 * transport cannot defer schema DDL (the Turso REMOTE transport), pinned
 * without a database. CI has no `sqld`, so the end-to-end run
 * (`apply.remote-face.integration.test.ts`) skips there; these hold the two
 * halves that decide it:
 *
 *  1. **The posture.** Both commands boot with `deferredDdlUnsupported:
 *     'skip-schema-sync'` beside `deferSchemaDdl`, and compose identically, so
 *     the plan an operator reads is the one the apply confirms. Without the
 *     opt-in both refuse at the boot again on every hosted tenant.
 *  2. **The verdict.** Every drift entry the driver was asked to apply and did
 *     not is named; a destructive one the operator confirmed makes the run
 *     PARTIAL (exit 1, `message: 'partial'`); a non-destructive one is named
 *     and the exit stays 0; an entry held back for lack of
 *     `--allow-destructive` is not "not applied". A boot that skipped schema
 *     sync says its additive half was not examined, in both faces.
 *
 * `bootSchemaStack` is stubbed with a stack answering a fixed drift report.
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

type ApplyCommand = (typeof import('./apply.js'))['default'];
type PlanCommand = (typeof import('./plan.js'))['default'];
let MigrateApply: ApplyCommand;
let MigratePlan: PlanCommand;
let SKIPPED_SCHEMA_SYNC_NOTE: string;

beforeAll(async () => {
  ({ default: MigrateApply } = await import('./apply.js'));
  ({ default: MigratePlan } = await import('./plan.js'));
  ({ SKIPPED_SCHEMA_SYNC_NOTE } = await import('../../utils/schema-migrate.js'));
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

/** [#23925] What a driver declares for an op its apply door cannot perform (the REMOTE face's sentence). */
const APPLY_LIMIT = 'it needs the SQLite table rebuild, which the Turso REMOTE transport does not run';

const entry = (column: string, type: string, category: Entry['category']): Entry => ({
  kind: 'nullability_mismatch', remoteName: 't23848', table: 't23848', column, severity: 'warning', category,
  op: { type, table: 't23848', column }, message: `t23848.${column}: ${type}`,
});

/**
 * A booted stack as `bootSchemaStack` answers it: `drift` is the report, and
 * the driver applies exactly the entries in `applies` — any other entry it is
 * asked to apply comes back skipped, as a driver reports one its transport
 * cannot perform. A destructive entry without `allowDestructive` is skipped
 * unattempted, as the base contract says.
 *
 * [#23925] `limited` names the op types the reporting driver declares its apply
 * door cannot perform (`SchemaStack.driftApplyLimit`); empty is a driver that
 * declares nothing.
 */
function stackWith(
  drift: Entry[],
  applies: Entry[],
  schemaSync: 'skipped' | 'deferred',
  limited: ReadonlySet<string> = new Set(),
) {
  const applyMigrationEntries = vi.fn(async (entries: Entry[], opts: { allowDestructive?: boolean }) => {
    const applied: Entry[] = [];
    const skipped: Entry[] = [];
    for (const e of entries) {
      if (e.category === 'destructive' && !opts.allowDestructive) skipped.push(e);
      else (applies.includes(e) ? applied : skipped).push(e);
    }
    return { applied, skipped };
  });
  return {
    applyMigrationEntries,
    stack: {
      driver: { config: { url: 'libsql://tenant.example' } },
      dbLabel: 'libsql://tenant.example',
      dbSource: { kind: 'flag' },
      schemaSync,
      telemetryDatabase: null,
      drivers: [],
      detectManagedDrift: vi.fn(async () => drift),
      applyMigrationEntries,
      driftApplyLimit: (e: Entry): string | null => (limited.has(e.op.type) ? APPLY_LIMIT : null),
      pendingSchemaWork: [],
      flushSchemaDdl: vi.fn(async () => []),
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
async function run(
  command: ApplyCommand | PlanCommand,
  argv: string[],
): Promise<{ payload: any; lines: string; exitCode: number }> {
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
    await (command === MigrateApply ? MigrateApply.run(argv, { root: CLI_ROOT }) : MigratePlan.run(argv, { root: CLI_ROOT }));
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
  return { payload: argv.includes('--json') ? JSON.parse(out) : null, lines: said.join('\n'), exitCode };
}

const where = (entries: Entry[] | undefined) => (entries ?? []).map((e) => `${e.column} ${e.op.type}`);

describe('plan and apply boot with the skip-schema-sync posture, identically', () => {
  const POSTURE = { deferSchemaDdl: true, deferredDdlUnsupported: 'skip-schema-sync' };
  const COMPOSITION = { composeHostStack: true, composeServedPlatform: true };

  it('the plan boot', async () => {
    await run(MigratePlan, ['--json']);
    expect(boot).toHaveBeenCalledTimes(1);
    expect(boot.mock.calls[0]![0]).toEqual(expect.objectContaining({ ...POSTURE, ...COMPOSITION, readOnlyProbe: true }));
  }, CASE_TIMEOUT_MS);

  it('the apply boot — and it differs from the plan\'s only by the read-only probe', async () => {
    await run(MigrateApply, ['--json']);
    await run(MigratePlan, ['--json']);
    expect(boot).toHaveBeenCalledTimes(2);
    const [applyOpts, planOpts] = [boot.mock.calls[0]![0], boot.mock.calls[1]![0]];
    expect(applyOpts).toEqual(expect.objectContaining({ ...POSTURE, ...COMPOSITION }));
    const { readOnlyProbe, ...planRest } = planOpts;
    expect(readOnlyProbe).toBe(true);
    expect(applyOpts).toEqual(planRest);
  }, CASE_TIMEOUT_MS);
});

describe('apply names every entry the driver did not apply', () => {
  const drop = entry('legacy', 'drop_column', 'destructive');
  const tighten = entry('code', 'tighten_not_null', 'destructive');
  const relax = entry('memo', 'relax_not_null', 'needs_confirm');

  it('--allow-destructive, a destructive entry not applied: named, message partial, exit 1', async () => {
    const { stack } = stackWith([drop, tighten, relax], [drop], 'skipped');
    boot.mockResolvedValueOnce(stack);
    const { payload, exitCode } = await run(MigrateApply, ['--allow-destructive', '--yes', '--json']);
    expect(exitCode).toBe(1);
    expect(payload).toMatchObject({ message: 'partial', schemaSync: 'skipped', database: 'libsql://tenant.example' });
    expect(where(payload.applied)).toEqual(['legacy drop_column']);
    expect(where(payload.notApplied)).toEqual(['code tighten_not_null', 'memo relax_not_null']);
  }, CASE_TIMEOUT_MS);

  it('the human face: each one by table, column and kind, and the run says PARTIAL; exit 1', async () => {
    const { stack } = stackWith([drop, tighten, relax], [drop], 'skipped');
    boot.mockResolvedValueOnce(stack);
    const { lines, exitCode } = await run(MigrateApply, ['--allow-destructive', '--yes']);
    expect(exitCode).toBe(1);
    expect(lines).toContain(SKIPPED_SCHEMA_SYNC_NOTE);
    expect(lines).toContain('t23848.code — tighten_not_null (destructive)');
    expect(lines).toContain('t23848.memo — relax_not_null');
    expect(lines).toMatch(/PARTIAL apply: 1 destructive change\(s\)/);
  }, CASE_TIMEOUT_MS);

  it('without --allow-destructive: the held-back destructive two are not "not applied"; the needs-confirm one is named; exit 0', async () => {
    const { stack } = stackWith([drop, tighten, relax], [], 'skipped');
    boot.mockResolvedValueOnce(stack);
    const { payload, exitCode } = await run(MigrateApply, ['--yes', '--json']);
    expect(exitCode).toBe(0);
    expect(payload.message).toBeUndefined();
    expect(where(payload.notApplied)).toEqual(['memo relax_not_null']);
    expect(where(payload.skipped)).toEqual(['legacy drop_column', 'code tighten_not_null', 'memo relax_not_null']);
  }, CASE_TIMEOUT_MS);

  it('CONTROL: every entry applied: notApplied is empty, no message, exit 0, no schemaSync key on a deferring boot', async () => {
    const { stack } = stackWith([drop, tighten, relax], [drop, tighten, relax], 'deferred');
    boot.mockResolvedValueOnce(stack);
    const { payload, exitCode } = await run(MigrateApply, ['--allow-destructive', '--yes', '--json']);
    expect(exitCode).toBe(0);
    expect(payload.message).toBeUndefined();
    expect(payload).not.toHaveProperty('schemaSync');
    expect(payload.notApplied).toEqual([]);
    expect(where(payload.applied)).toEqual(['legacy drop_column', 'code tighten_not_null', 'memo relax_not_null']);
  }, CASE_TIMEOUT_MS);
});

describe('a boot that skipped schema sync never reads as "in sync"', () => {
  it('apply: in_sync_partial and schemaSync skipped; a deferring boot still says in_sync', async () => {
    boot.mockResolvedValueOnce(stackWith([], [], 'skipped').stack);
    const skipped = await run(MigrateApply, ['--json']);
    expect(skipped.payload).toMatchObject({ message: 'in_sync_partial', schemaSync: 'skipped' });

    boot.mockResolvedValueOnce(stackWith([], [], 'deferred').stack);
    const deferred = await run(MigrateApply, ['--json']);
    expect(deferred.payload.message).toBe('in_sync');
    expect(deferred.payload).not.toHaveProperty('schemaSync');
  }, CASE_TIMEOUT_MS);

  it('plan: the JSON carries schemaSync skipped, and the human face says PARTIAL and why', async () => {
    boot.mockResolvedValueOnce(stackWith([], [], 'skipped').stack);
    const json = await run(MigratePlan, ['--json']);
    expect(json.exitCode).toBe(0);
    expect(json.payload).toMatchObject({ schemaSync: 'skipped', pending: [], total: 0 });

    boot.mockResolvedValueOnce(stackWith([], [], 'skipped').stack);
    const human = await run(MigratePlan, []);
    expect(human.lines).toContain(SKIPPED_SCHEMA_SYNC_NOTE);
    expect(human.lines).toMatch(/PARTIAL plan: it is not evidence that every declared table and column exists/);
    expect(human.lines).not.toMatch(/in sync with metadata — nothing to migrate/);
  }, CASE_TIMEOUT_MS);
});

/**
 * [#23925] The apply's listing before its prompt reads the reporting driver's
 * declaration, as `os migrate plan` does: an entry its database cannot apply
 * shows its finding and the driver's limit, never `--allow-destructive`, and
 * the held-back count offers a re-run only for the destructive entries that
 * re-run could apply. Its `notApplied` report, exit code and `--json` are
 * not this card's, and are pinned unchanged.
 */
describe('apply\'s listing reads the driver\'s apply limit', () => {
  const T = 't23925';
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
  const LIMITED = new Set(['tighten_not_null', 'relax_not_null']);
  const LIMIT_SENTENCE = `"os migrate apply" cannot apply it on this database: ${APPLY_LIMIT}.`;

  /** The line the listing prints under an entry's `[op]` heading. */
  const entryLine = (lines: string, op: string): string => {
    const all = lines.split('\n');
    const at = all.findIndex((l) => l.includes(`[${op}]`));
    expect(at, `no [${op}] entry in:\n${lines}`).toBeGreaterThanOrEqual(0);
    return all[at + 1]!;
  };
  const skippedLines = (lines: string) => lines.split('\n').filter((l) => /will be SKIPPED|re-run with --allow-destructive cannot/.test(l));
  /** The held-back lines the apply prints after it ran. */
  const postApplySkippedLines = (lines: string) => lines.split('\n').filter((l) => l.startsWith('  ⚠ Skipped '));

  it('without --allow-destructive: the limited entries name the limit; only the drop is offered a re-run, the tightening is named as drift no re-run applies', async () => {
    boot.mockResolvedValueOnce(stackWith([DROP, TIGHTEN, RELAX], [DROP], 'skipped', LIMITED).stack);
    const { lines, exitCode } = await run(MigrateApply, ['--yes']);
    expect(exitCode, lines).toBe(0);

    const tighten = entryLine(lines, 'tighten_not_null');
    expect(tighten).not.toContain('--allow-destructive');
    expect(tighten).toContain(`${T}.code: metadata declares \`storage.notNull\` but the column is nullable — existing nulls must be backfilled. ${LIMIT_SENTENCE}`);
    expect(entryLine(lines, 'relax_not_null')).toContain(LIMIT_SENTENCE);
    expect(entryLine(lines, 'drop_column')).toBe(`        ${DROP.message}`);

    expect(skippedLines(lines)).toEqual([
      '  ⚠ 1 destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).',
      '  ⚠ 1 destructive change(s) remain drift that a re-run with --allow-destructive cannot apply on this database either (each says why above).',
    ]);
    // Unchanged after the prompt: the needs-confirm entry the driver could not apply is still named.
    expect(lines).toContain('t23925.memo — relax_not_null');
    // The post-apply held-back line splits the same way.
    expect(postApplySkippedLines(lines)).toEqual([
      '  ⚠ Skipped 1 destructive change(s) (re-run with --allow-destructive to include them).',
      '  ⚠ Skipped 1 destructive change(s) that a re-run could not apply on this database either: they remain drift (each says why above).',
    ]);
  }, CASE_TIMEOUT_MS);

  it('with --allow-destructive: the listing names the limit, and the notApplied report, PARTIAL and exit 1 are unchanged', async () => {
    boot.mockResolvedValueOnce(stackWith([DROP, TIGHTEN, RELAX], [DROP], 'skipped', LIMITED).stack);
    const { lines, exitCode } = await run(MigrateApply, ['--allow-destructive', '--yes']);
    expect(exitCode, lines).toBe(1);
    expect(entryLine(lines, 'tighten_not_null')).toContain(LIMIT_SENTENCE);
    expect(entryLine(lines, 'tighten_not_null')).not.toContain('--allow-destructive');
    expect(skippedLines(lines)).toEqual([]);
    expect(lines).toContain('t23925.code — tighten_not_null (destructive)');
    expect(lines).toMatch(/PARTIAL apply: 1 destructive change\(s\)/);
  }, CASE_TIMEOUT_MS);

  it('--json: the document is the one a driver that declares nothing gets, key for key and entry for entry', async () => {
    boot.mockResolvedValueOnce(stackWith([DROP, TIGHTEN, RELAX], [DROP], 'skipped', LIMITED).stack);
    const limited = await run(MigrateApply, ['--yes', '--json']);
    boot.mockResolvedValueOnce(stackWith([DROP, TIGHTEN, RELAX], [DROP], 'skipped').stack);
    const declaresNothing = await run(MigrateApply, ['--yes', '--json']);
    const withoutDuration = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'duration'));
    expect(limited.exitCode).toBe(declaresNothing.exitCode);
    expect(withoutDuration(limited.payload)).toEqual(withoutDuration(declaresNothing.payload));
  }, CASE_TIMEOUT_MS);

  it('CONTROL: a driver that declares nothing gets the listing and the held-back line it always got', async () => {
    boot.mockResolvedValueOnce(stackWith([DROP, TIGHTEN, RELAX], [DROP], 'skipped').stack);
    const { lines, exitCode } = await run(MigrateApply, ['--yes']);
    expect(exitCode, lines).toBe(0);
    expect(entryLine(lines, 'tighten_not_null')).toBe(`        ${TIGHTEN.message}`);
    expect(entryLine(lines, 'relax_not_null')).toBe(`        ${RELAX.message}`);
    expect(entryLine(lines, 'drop_column')).toBe(`        ${DROP.message}`);
    expect(skippedLines(lines)).toEqual(['  ⚠ 2 destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).']);
    expect(postApplySkippedLines(lines)).toEqual(['  ⚠ Skipped 2 destructive change(s) (re-run with --allow-destructive to include them).']);
    expect(lines).not.toContain('cannot apply it on this database');
  }, CASE_TIMEOUT_MS);
});
