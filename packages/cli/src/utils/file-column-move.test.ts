// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15989] `runFileColumnMove` — the orchestration half of the ADR-0104 column
 * step, and the three properties an operator's data depends on:
 *
 *  1. ⛔ **NO statement runs until EVERY pre-check has passed.** A step that
 *     moved three columns and then aborted on the fourth leaves a datastore in
 *     a state no flag can describe.
 *  2. ⛔ **A dry run executes reads and only reads.** The contract is different
 *     from `os migrate multi-value-columns`' ("the seam is never called") and
 *     the difference is deliberate: the one thing an operator needs to know
 *     before a column move is whether it would abort, and that answer is a
 *     `SELECT`. The report says which statements ran, and on a dry run that
 *     list is empty.
 *  3. ⛔ **An empty plan earns no stamp.** `[].every(…)` is `true`, which is
 *     exactly the certificate over nothing this step must never issue.
 *
 * The statements themselves are `@objectstack/driver-sql`'s and are pinned
 * there, live, against every dialect this step serves.
 */

import { describe, it, expect } from 'vitest';
import type { MediaColumnMovePlan, MediaColumnMoveScan } from '@objectstack/driver-sql';
import { describeFileColumnMoveRefusal, runFileColumnMove } from './file-column-move.js';

const plan = (table: string, column: string, kind: MediaColumnMovePlan['kind'] = 'retype'): MediaColumnMovePlan => ({
  dialect: 'postgres',
  kind,
  table,
  column,
  precheck: `PRECHECK ${table}.${column}`,
  precheckMeaning: 'cell(s) hold a JSON value that is not a string.',
  statement: `MOVE ${table}.${column}`,
});

const scanOf = (plans: MediaColumnMovePlan[], refusals: MediaColumnMoveScan['refusals'] = []): MediaColumnMoveScan => ({
  dialect: 'postgres',
  plans,
  refusals,
});

/**
 * A seam that records every statement it is handed, and answers each
 * pre-check with the count `blocking` names for it.
 */
function seam(blocking: Record<string, number> = {}, opts: { throwOn?: string } = {}) {
  const sent: string[] = [];
  const exec = async (sql: string): Promise<unknown> => {
    sent.push(sql);
    if (opts.throwOn && sql === opts.throwOn) throw new Error(`server refused: ${sql}`);
    if (sql.startsWith('PRECHECK ')) return [{ n: blocking[sql.slice('PRECHECK '.length)] ?? 0 }];
    return [];
  };
  const rows = (r: unknown) => (Array.isArray(r) ? (r as Array<Record<string, unknown>>) : []);
  return { exec, rows, sent, moves: () => sent.filter((s) => s.startsWith('MOVE ')) };
}

describe('#15989 — phase 1 runs EVERY pre-check before any statement', () => {
  it('one blocked column stops the WHOLE step — the others are not attempted', async () => {
    const s = seam({ 'b.cover': 2 });
    const result = await runFileColumnMove({
      scan: scanOf([plan('a', 'cover'), plan('b', 'cover'), plan('c', 'cover')]),
      exec: s.exec,
      rows: s.rows,
      apply: true,
    });

    expect(s.moves(), '⛔ not a single statement may run').toEqual([]);
    expect(result.executedStatements).toEqual([]);
    expect(result.blocking).toBe(2);
    expect(result.recordable).toBe(false);
    expect(result.outcomes.map((o) => o.status)).toEqual(['not_attempted', 'blocked', 'not_attempted']);
    // …and every pre-check DID run, so the report names every blocked column
    // rather than stopping at the first.
    expect(s.sent.filter((x) => x.startsWith('PRECHECK ')).length).toBe(3);
  });

  it('⭐ CONTROL — with every pre-check at zero, every statement runs and the step is recordable', async () => {
    const s = seam();
    const result = await runFileColumnMove({
      scan: scanOf([plan('a', 'cover'), plan('b', 'cover')]),
      exec: s.exec,
      rows: s.rows,
      apply: true,
    });
    expect(s.moves()).toEqual(['MOVE a.cover', 'MOVE b.cover']);
    expect(result.recordable).toBe(true);
    expect(result.outcomes.every((o) => o.status === 'moved')).toBe(true);
  });

  it('a pre-check that answers NOTHING READABLE is a failure, not a zero', async () => {
    // Moving a column on the strength of a reading that never happened is the
    // same defect one layer up as the clause this card had to overturn.
    const s = seam();
    const badRows = () => [] as Array<Record<string, unknown>>;
    const result = await runFileColumnMove({
      scan: scanOf([plan('a', 'cover')]),
      exec: s.exec,
      rows: badRows,
      apply: true,
    });
    expect(s.moves()).toEqual([]);
    expect(result.outcomes[0]!.status).toBe('failed');
    expect(result.recordable).toBe(false);
  });

  it('a pre-check that THROWS stops the step', async () => {
    const s = seam({}, { throwOn: 'PRECHECK a.cover' });
    const result = await runFileColumnMove({
      scan: scanOf([plan('a', 'cover'), plan('b', 'cover')]),
      exec: s.exec,
      rows: s.rows,
      apply: true,
    });
    expect(s.moves()).toEqual([]);
    expect(result.recordable).toBe(false);
    expect(result.outcomes[0]!.status).toBe('failed');
  });
});

describe('#15989 — a dry run reads, and only reads', () => {
  it('runs every pre-check and executes no statement', async () => {
    const s = seam();
    const result = await runFileColumnMove({
      scan: scanOf([plan('a', 'cover'), plan('b', 'cover')]),
      exec: s.exec,
      rows: s.rows,
      apply: false,
    });
    expect(s.sent).toEqual(['PRECHECK a.cover', 'PRECHECK b.cover']);
    expect(s.moves()).toEqual([]);
    expect(result.executedStatements).toEqual([]);
    // ⛔ A dry run can never earn the stamp, however clean.
    expect(result.recordable).toBe(false);
    expect(result.outcomes.every((o) => o.status === 'planned')).toBe(true);
  });

  it('a dry run over a BLOCKED column reports the abort without touching anything', async () => {
    const s = seam({ 'a.cover': 7 });
    const result = await runFileColumnMove({
      scan: scanOf([plan('a', 'cover')]),
      exec: s.exec,
      rows: s.rows,
      apply: false,
    });
    expect(result.blocking).toBe(7);
    expect(s.moves()).toEqual([]);
    expect(describeFileColumnMoveRefusal(result)).toMatch(/ABORTED before running any statement/);
  });
});

describe('#15989 — refusals stop the step, and an empty plan earns nothing', () => {
  it('⛔ a column that could not be PLANNED stops the columns that could', async () => {
    // Moving what could be seen and stamping the deployment as moved would
    // certify the columns nobody looked at.
    const s = seam();
    const result = await runFileColumnMove({
      scan: scanOf(
        [plan('a', 'cover')],
        [{ table: 'b', column: 'cover', reason: 'column_absent', detail: 'no such column' }],
      ),
      exec: s.exec,
      rows: s.rows,
      apply: true,
    });
    expect(s.moves()).toEqual([]);
    expect(result.recordable).toBe(false);
    expect(describeFileColumnMoveRefusal(result)).toMatch(/could not be planned/);
  });

  it('⛔ an EMPTY plan is not a completed move — `[].every(…)` is true and must not be believed', async () => {
    const s = seam();
    const result = await runFileColumnMove({ scan: scanOf([]), exec: s.exec, rows: s.rows, apply: true });
    expect(result.outcomes).toEqual([]);
    expect(result.recordable, 'a certificate over nothing').toBe(false);
    expect(describeFileColumnMoveRefusal(result)).toBeNull();
  });
});

describe('#15989 — a statement that fails mid-run', () => {
  it('stops the rest and is NOT recordable', async () => {
    const s = seam({}, { throwOn: 'MOVE b.cover' });
    const result = await runFileColumnMove({
      scan: scanOf([plan('a', 'cover'), plan('b', 'cover'), plan('c', 'cover')]),
      exec: s.exec,
      rows: s.rows,
      apply: true,
    });
    expect(result.outcomes.map((o) => o.status)).toEqual(['moved', 'failed', 'not_attempted']);
    expect(s.moves()).toEqual(['MOVE a.cover', 'MOVE b.cover']);
    // ⭐ The half-moved datastore stays OFF the bare arm, which is what keeps
    // it readable: the driver goes on reading both encodings.
    expect(result.recordable).toBe(false);
    expect(result.outcomes[1]!.error).toMatch(/server refused/);
  });
});
