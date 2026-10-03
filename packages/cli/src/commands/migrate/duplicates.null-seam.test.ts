// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10677 — the `no_sql_seam` refusal was dead code for a seam that answers nothing.
 *
 * #8928's ruling made "this driver cannot be probed" a LOUD failure precisely
 * because the alternative is unfalsifiable: a scan that answers `duplicates:[]`
 * over a driver it never queried is indistinguishable from a scan that queried
 * and found nothing. The refusal existed, and for the in-memory (mingo) driver
 * it never ran — measured on framework `79ebb37`:
 *
 *     os migrate duplicates --database-url memory://qa
 *       -> exit 0, duplicates: [], skipped: [], counters.status: "read"
 *       -> stderr: 3x "Raw execution not supported in InMemory driver"
 *
 * `InMemoryDriver.execute()` logs that warning and returns `null`. It neither
 * throws nor is absent, so `resolveSeedTenancyExec`'s `typeof d.execute ===
 * 'function'` test — a question about the driver's SHAPE — was satisfied, and
 * `normalizeRows(null)` is `[]`, which is also what a real driver returns for a
 * SELECT that matched nothing.
 *
 * ⭐ So what these tests pin is NOT "memory reports no_sql_seam". It is the
 * distinction the guard keys on: **a seam that cannot ANSWER is absent, not
 * empty.** No driver is named by the implementation — the seam is judged by
 * what it returns.
 *
 * ## A seam DOUBLE, not a boot on the mingo engine
 *
 * These cases used to boot the in-memory engine through `memory://` to get a
 * real no-op seam. That engine is no longer a boot store — every boot door
 * refuses its spellings and schemes — and a refusal is not something to boot a
 * retired engine to test. The no-op shape is a VALUE (`execute` resolves
 * `null`), so it is reproduced here as a unit-level double: an engine whose
 * default driver has a callable `execute` that answers nothing. That is exactly
 * the shape the measured driver had, and the shape the guard has to separate
 * from "answered no rows"; the command itself runs for real on top of it, with
 * only `bootSchemaStack` (the seam that would open a database) replaced.
 *
 * The mongodb branch is deliberately NOT asserted anywhere in this file: it was
 * not exercised for this fix, and an assertion about a driver this suite never
 * loads would be a false pin.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSeedTenancyExec, normalizeRows, collectRuntimeIndexPreflight, GLOBAL_TENANT, ORGANIZATION_FIELD, SEQUENCES_TABLE } from '@objectstack/metadata-protocol';
import MigrateDuplicates, {
  answeringSeam,
  collectDuplicateIdentifierReport,
  isResultSet,
  seamAnswersNothing,
} from './duplicates.js';

// ⛔ `vi.hoisted`, never a value import of `bootSchemaStack`: this suite boots
// nothing, and a value import of that symbol is what files a test in the
// integration tier (`vitest-tiers.ts`).
const mocks = vi.hoisted(() => ({ bootSchemaStack: vi.fn() }));
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: mocks.bootSchemaStack }));

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');

/** The population the scan walks: one object with one identifier the probe must read. */
const OBJECTS = [
  {
    name: 'crm_case',
    fields: { subject: { type: 'text' }, case_number: { type: 'autonumber' } },
  },
];

/**
 * The no-op seam, as a value: a driver whose `execute` is callable and answers
 * nothing — `InMemoryDriver.execute()`'s measured shape (warn, return `null`).
 * `statements` records what reached it, so a case can show the probes RAN.
 */
function noAnswerEngine(): { engine: { driver: { execute: (sql: string, params?: unknown[]) => Promise<null> } }; statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    engine: {
      driver: {
        execute: async (sql: string) => {
          statements.push(sql);
          return null;
        },
      },
    },
  };
}

/** The stack `bootSchemaStack` hands the command — only the members `duplicates.ts` reads. */
function stackOver(engine: unknown) {
  return {
    kernel: { getService: (name: string) => (name === 'objectql' ? engine : undefined) },
    allObjects: () => OBJECTS,
    dbLabel: 'seam-double',
    driver: undefined,
    shutdown: vi.fn(async () => {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.bootSchemaStack.mockReset();
});

// ───────────────────────────────────────────────────────────────────────────
// 1. The separation itself, on values
// ───────────────────────────────────────────────────────────────────────────

describe('#10677 isResultSet — "answered nothing" is not "answered no rows"', () => {
  it('accepts every dialect result-set shape, INCLUDING the empty spellings', () => {
    // better-sqlite3 through knex: a bare row array.
    expect(isResultSet([{ dup_value: 'CASE-1' }])).toBe(true);
    expect(isResultSet([])).toBe(true);
    // pg: `{ rows, rowCount, … }`.
    expect(isResultSet({ rows: [{ dup_value: 'CASE-1' }], rowCount: 1 })).toBe(true);
    expect(isResultSet({ rows: [], rowCount: 0 })).toBe(true);
    // mysql2: the `[rows, fields]` tuple.
    expect(isResultSet([[{ dup_value: 'CASE-1' }], []])).toBe(true);
    expect(isResultSet([[], []])).toBe(true);
  });

  it('rejects the fourth thing a seam can hand back — no result set at all', () => {
    // The measured shape: `InMemoryDriver.execute()` returns exactly this.
    expect(isResultSet(null)).toBe(false);
    expect(isResultSet(undefined)).toBe(false);
    // A host that echoes the statement back rather than running it.
    expect(isResultSet('select 1')).toBe(false);
    expect(isResultSet({})).toBe(false);
    expect(isResultSet({ rows: 'not-an-array' })).toBe(false);
  });

  it('rejects only shapes normalizeRows already flattens to [] — no row can be lost', () => {
    for (const shape of [null, undefined, 'select 1', {}, { rows: 'not-an-array' }, 42]) {
      expect(isResultSet(shape)).toBe(false);
      expect(normalizeRows(shape)).toEqual([]);
    }
  });
});

describe('#10677 the two guards, on hand-built seams', () => {
  it('seamAnswersNothing: true for a seam that returns, false for one that answers', async () => {
    expect(await seamAnswersNothing(async () => null)).toBe(true);
    expect(await seamAnswersNothing(async () => [])).toBe(false);
    expect(await seamAnswersNothing(async () => [{ os_seam_probe: 1 }])).toBe(false);
  });

  it('seamAnswersNothing: a seam that THROWS is left alone — that path is unchanged', async () => {
    // Throwing is a driver present and refusing LOUDLY. The per-probe `skipped`
    // path already reports it honestly, so this guard must not claim it: doing
    // so would turn an honest partial report into a refusal #8928 never
    // mandated, and would swallow a transient connection error as "no seam".
    expect(
      await seamAnswersNothing(async () => {
        throw new Error('ECONNREFUSED');
      }),
    ).toBe(false);
  });

  it('answeringSeam: passes result sets through and fails a non-answer', async () => {
    const rows = [{ dup_value: 'CASE-1' }];
    await expect(answeringSeam(async () => rows)('select 1')).resolves.toBe(rows);
    await expect(answeringSeam(async () => [])('select 1')).resolves.toEqual([]);
    await expect(answeringSeam(async () => null)('select 1')).rejects.toThrow(/no result set/);
  });

  it('answeringSeam: forwards sql and bound params untouched', async () => {
    const seen: Array<[string, unknown[] | undefined]> = [];
    const wrapped = answeringSeam(async (sql, params) => {
      seen.push([sql, params]);
      return [];
    });
    await wrapped('select ?', ['x']);
    expect(seen).toEqual([['select ?', ['x']]]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The no-op seam, resolved the way the command resolves it
// ───────────────────────────────────────────────────────────────────────────

describe('#10677 a driver whose execute answers nothing, through the real resolver', () => {
  it('has the SHAPE of a seam and answers nothing — the two the guard had to separate', async () => {
    const { engine } = noAnswerEngine();
    const exec = resolveSeedTenancyExec(engine);

    // The half that made the refusal dead code: the resolver still says yes.
    // It asks whether `execute` is callable, and on this driver it is.
    expect(exec, 'the shape test still passes — that is the defect, not a bug in the resolver').toBeTypeOf('function');

    // The half the guard asks about: it accepts the statement and hands back no
    // result set.
    await expect(exec!('select 1 as os_seam_probe', [])).resolves.toBeNull();
    expect(await seamAnswersNothing(exec!)).toBe(true);
  });

  it('bare exec produces the false all-clear; the wrapped seam reports it as unreadable', async () => {
    const { engine, statements } = noAnswerEngine();
    const exec = resolveSeedTenancyExec(engine)!;
    const opts = {
      normalize: normalizeRows,
      objects: OBJECTS,
      database: 'seam-double',
      globalTenant: GLOBAL_TENANT,
      organizationField: ORGANIZATION_FIELD,
      sequencesTable: SEQUENCES_TABLE,
      runtimeIndexPreflight: [],
    };

    // The population is real, so "nothing was scanned" cannot explain the
    // empty result below — and the probes did reach the seam.
    const before = await collectDuplicateIdentifierReport({ ...opts, exec });
    expect(before.scanned.map((t) => `${t.object}.${t.field}`)).toContain('crm_case.case_number');
    expect(statements.length).toBeGreaterThan(0);

    // ── The defect, reproduced in-test ──────────────────────────────────
    // Every probe was swallowed, and the report says the install is clean.
    expect(before.duplicates).toEqual([]);
    expect(before.skipped).toEqual([]);
    expect(before.counters.status).toBe('read');

    // ── The same seam, held to "must answer" ────────────────────────────
    const after = await collectDuplicateIdentifierReport({ ...opts, exec: answeringSeam(exec) });
    expect(after.scanned).toEqual(before.scanned);
    expect(after.skipped.map((s) => `${s.object}.${s.field ?? ''}`)).toContain('crm_case.case_number');
    for (const entry of after.skipped) expect(entry.reason).toMatch(/no result set/);
    // The counter table is no longer claimed as read, either.
    expect(after.counters.status).toBe('absent');

    // ── The same separation, on the #8725 pre-flight ────────────────────
    // Its per-index presence question reads a refusal as "this table is not
    // installed", which is right on a working seam and catastrophic on this
    // one — tightenings reported as absent by a probe that never ran. So the
    // pre-flight proves the SEAM live first, against a statement whose failure
    // cannot mean "absent", and reports every index as `unreadable`.
    const preflight = await collectRuntimeIndexPreflight(answeringSeam(exec));
    expect(preflight.length).toBeGreaterThan(0);
    expect(new Set(preflight.map((p) => p.status))).toEqual(new Set(['unreadable']));
    for (const entry of preflight) expect(String(entry.detail)).toMatch(/no result set/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The command itself — the symptom the QA run filed
// ───────────────────────────────────────────────────────────────────────────

describe('#10677 os migrate duplicates on a no-op seam', () => {
  /**
   * Run the real command, capturing the payload.
   *
   * `process.exitCode` is process-global and `emitJson` sets it, so it is saved
   * and restored here — a test that left it at 1 would fail the whole vitest
   * run from the outside, with nothing pointing back at this file.
   *
   * The stdout spy is installed BEFORE the command boots because the JSON boot
   * reserves stdout and captures whatever `process.stdout.write` is at that
   * moment (the mechanism `json-stdout.test.ts` documents).
   */
  async function runCommand(args: string[]): Promise<{ out: string; exitCode: number | undefined }> {
    const savedExit = process.exitCode;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: any, ...rest: any[]) => {
      const cb = rest.find((a) => typeof a === 'function');
      if (cb) cb();
      return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: any, ...rest: any[]) => {
      const cb = rest.find((a) => typeof a === 'function');
      if (cb) cb();
      return true;
    }) as typeof process.stderr.write);
    try {
      await MigrateDuplicates.run(args, { root: CLI_ROOT });
      return {
        out: stdout.mock.calls.map((c) => String(c[0])).join(''),
        exitCode: process.exitCode as number | undefined,
      };
    } finally {
      process.exitCode = savedExit;
      vi.restoreAllMocks();
    }
  }

  it('refuses loudly with no_sql_seam and exit 1 instead of a clean empty report', async () => {
    const { engine } = noAnswerEngine();
    const stack = stackOver(engine);
    mocks.bootSchemaStack.mockResolvedValue(stack);
    const { out, exitCode } = await runCommand(['--database-url', 'file:/tmp/os-10677-seam-double.db']);

    // The command reached the seam through the boot it asked for, read-only.
    expect(mocks.bootSchemaStack).toHaveBeenCalledWith(
      expect.objectContaining({ databaseUrl: 'file:/tmp/os-10677-seam-double.db', readOnlyProbe: true }),
    );

    // ONE document on stdout, and it is the refusal — not a report.
    const payload = JSON.parse(out) as { error?: string; detail?: string; duplicates?: unknown };
    expect(payload.error).toBe('no_sql_seam');
    expect(exitCode).toBe(1);

    // The shape that must never come back: the clean bill of health.
    expect(payload).not.toHaveProperty('duplicates');
    expect(payload).not.toHaveProperty('summary');
    // The detail names the case that was invisible before — a seam that is
    // present and returns nothing, not merely one that is missing.
    expect(payload.detail).toMatch(/returning no result set/);
    // …and the stack it booted is released on the refusal path too.
    expect(stack.shutdown).toHaveBeenCalled();
  }, 120_000);

  // Control: the same command over a seam that ANSWERS (an empty result set)
  // is not refused — so the refusal above is the no-answer shape, not "any
  // double".
  it('control: a seam that answers with an empty result set is read, not refused', async () => {
    const answering = { driver: { execute: async () => [] } };
    mocks.bootSchemaStack.mockResolvedValue(stackOver(answering));
    const { out, exitCode } = await runCommand(['--database-url', 'file:/tmp/os-10677-seam-double.db']);
    const payload = JSON.parse(out) as { error?: string; duplicates?: unknown };
    expect(payload.error).toBeUndefined();
    expect(payload.duplicates).toEqual([]);
    expect(exitCode ?? 0).toBe(0);
  }, 120_000);
});
