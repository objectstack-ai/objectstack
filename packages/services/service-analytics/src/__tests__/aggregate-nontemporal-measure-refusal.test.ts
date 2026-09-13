// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16099 — a DERIVING aggregate (`sum` / `avg`) over a field type that cannot
 * carry it is REFUSED at compile time, for every field type and not only the
 * temporal class.
 *
 * ## What this card found, driven before anything was written
 *
 * #16778 landed the compile leg of the director ruling (decision batch #59:
 * one compatibility table in `@objectstack/spec`, two refusal legs) SCOPED to
 * temporal source fields. The residual was "every other non-temporal pair the
 * table refuses", and the dispatch required it be driven rather than read,
 * because a zero would have been the interesting answer. It is not a zero:
 *
 * ```
 * DRIVE-NAMED   sum × text   table_refuses=true  threw=NO  sql_emitted=1
 * DRIVE-SWEEP   6 aggregates × 49 field types = 294 pairs
 *               refusedByTable=155  −temporal=6  −(min|max)×string=42
 *               RESIDUAL=107   residual_ACCEPTED_today=107  REFUSED_today=0
 * DRIVE-CONTROL avg × datetime/date/time  threw=DATASET_INVALID/400  sql_emitted=0
 * ```
 *
 * The control is what makes the 107 a reading of the tree rather than of a
 * blind harness: the SAME service, door and `sourceFieldMeta` hook sees the
 * three pairs #16778 enforces refused, with no statement emitted.
 *
 * ## Why the scope is an AGGREGATE class and not "the rest of the table"
 *
 * Enforcing the residual whole was tried on this card and MEASURED, not
 * reasoned about. With `min` / `max` × the string classes subtracted — the
 * subtraction the dispatch named as the load-bearing one — 15 cases in
 * `measure-result-type.test.ts` still went red, every one of them on
 * `min` × `json`: a pair the table refuses, in NO ruling's scope, driven end to
 * end by the same shared fixture as the string rows. Because that fixture
 * compiles every measure in ONE dataset, a single refused pair reds the whole
 * section.
 *
 * ⇒ The `min` / `max` population is one question. ⚠️ [#17560] It has since been
 * ANSWERED, in one pass: the director ruling of decision batch #127
 * (2026-09-13) refused all 74 of those pairs and enforced them through this
 * same door — the string classes stay refused as batch #59 ruled, the
 * non-string classes are refused and enforced, and `formula` is refused on the
 * table's own storage ground. So the aggregate-class line this card cut is
 * gone: every aggregate is judged over every field type, and the two cases at
 * the foot of this file are where that move is visible.
 *
 * ## Dissolution verification — direction predicted BEFORE running
 *
 * Narrowing `DERIVING_AGGREGATES` to `sum` alone must turn every `avg` refusal
 * case below red in the ordinary direction (the compile succeeds, SQL IS
 * emitted, so no case can pass vacuously on an empty result), and must leave
 * every `sum` case and every negative control green. The observed direction is
 * recorded in the PR body.
 */

import { describe, it, expect } from 'vitest';
import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  isAggregateCompatibleWithFieldType,
  FieldType,
} from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { TEMPORAL_SOURCE_FIELD_TYPES } from '../measure-result-type.js';

/**
 * One declared field per class the refusal population touches, plus the
 * numeric / boolean controls that must keep compiling.
 */
const FIELD_TYPES: Record<string, string> = {
  // refused for `sum` AND `avg`
  note: 'text',
  body_md: 'markdown',
  stage: 'select',
  tags_list: 'multiselect',
  owner_id: 'lookup',
  assignee: 'user',
  payload: 'json',
  attachment: 'file',
  where_at: 'location',
  margin: 'formula',
  case_no: 'autonumber',
  embedding: 'vector',
  // refused for `sum` only — a rate does not add (`isIncoherentAggregate`)
  win_rate: 'percent',
  // the temporal class #16778 already enforced, kept as the continuity control
  submitted_at: 'datetime',
  // accepted controls
  cycle_days: 'number',
  amount: 'currency',
  score: 'rating',
  is_urgent: 'boolean',
  flagged: 'toggle',
  child_total: 'summary',
};

/**
 * A service wired the way a host wires it: `sourceFieldMeta` answers the
 * declared type and every emitted statement is recorded, so a refusal can be
 * shown to have happened BEFORE the driver — the assertion that stops a case
 * from passing on a query that merely returned nothing.
 */
function makeService(rows: Array<Record<string, unknown>> = [{ status: 'open', probe_measure: 1 }]) {
  const sqls: string[] = [];
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_object: string, sql: string) => { sqls.push(sql); return rows; },
    sourceFieldMeta: (_o: string, f: string) => (FIELD_TYPES[f] ? { type: FIELD_TYPES[f] } : undefined),
  } as never);
  return { svc, sqls };
}

const dataset = (aggregate: string, field: string) => DatasetSchema.parse({
  name: 'task_metrics',
  label: 'Task metrics',
  object: 'duly_task',
  include: [],
  dimensions: [{ name: 'status', field: 'status', type: 'string' }],
  measures: [{ name: 'probe_measure', aggregate, field }],
});

const run = (aggregate: string, field: string, rows?: Array<Record<string, unknown>>) => {
  const { svc, sqls } = makeService(rows);
  return {
    sqls,
    go: () => svc.queryDataset(
      dataset(aggregate, field) as never,
      { dimensions: ['status'], measures: ['probe_measure'] } as never,
    ),
  };
};

/** The ADR-0112 envelope a caller-shaped dataset refusal must carry. */
async function refusalOf(fn: () => Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  try {
    await fn();
  } catch (e) {
    return e as Error & { code?: string; status?: number };
  }
  throw new Error('expected a refusal, none was thrown');
}

// ─────────────────────────────────────────────────────────────────────────────
// The contract this executes — read from the shipped table, never restated
// ─────────────────────────────────────────────────────────────────────────────

describe('#16099 — the pairs this leg refuses are the TABLE\'s, not this package\'s', () => {
  it('the named residual instance is a pair the shipped table refuses', () => {
    expect(isAggregateCompatibleWithFieldType('sum', 'text')).toBe(false);
  });

  it('`sum` × `percent` — the row the card named as "incoherent but refused nowhere"', () => {
    // The rate that does not add. `avg` × `percent` is ACCEPTED by the same
    // table on purpose, which is what makes this a row and not a class.
    expect(isAggregateCompatibleWithFieldType('sum', 'percent')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('avg', 'percent')).toBe(true);
  });

  it('⭐ the refused set, enumerated by the card that enforced each part — 155 pairs, 0 left over', () => {
    // The arithmetic the PR bodies show, asserted rather than narrated, so a
    // row moving upstream moves this count instead of leaving a stale claim.
    // ⚠️ [#17560] The `minmaxString` / `selecting` split this case used to carry
    // is retired with the reading behind it: the 42 string pairs were counted
    // apart because they were "ruled to be AMENDED" under #17513, and decision
    // batch #127 found no ruling behind that and declined to amend the table.
    // The 42 and the 32 are one population again, enforced in one pass.
    let refusedByTable = 0, temporal = 0, deriving = 0, selecting = 0;
    for (const a of Object.keys(AGGREGATE_FIELD_TYPE_COMPATIBILITY)) {
      for (const ft of FieldType.options) {
        if (isAggregateCompatibleWithFieldType(a, ft)) continue;
        refusedByTable++;
        if (a === 'min' || a === 'max') { selecting++; continue; }
        if (TEMPORAL_SOURCE_FIELD_TYPES.has(ft)) { temporal++; continue; }
        deriving++;
      }
    }
    expect(refusedByTable).toBe(155);
    expect(temporal).toBe(6);          // #16778's — `sum`/`avg` over the temporal class
    expect(deriving).toBe(75);         // #16099's — `sum`/`avg` over everything else
    expect(selecting).toBe(74);        // #17560's — `min`/`max`, 42 string + 32 non-string
    expect(temporal + deriving + selecting).toBe(refusedByTable);
    // ⭐ And nothing is left declared-but-unenforced: one door judges all six.
    expect(Object.keys(AGGREGATE_FIELD_TYPE_COMPATIBILITY).length).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The refusal, through the real service
// ─────────────────────────────────────────────────────────────────────────────

describe('#16099 — a DERIVING aggregate over a field type that cannot carry it is refused', () => {
  const REFUSED_FOR_BOTH: Array<[string, string]> = [
    ['note', 'text'], ['body_md', 'markdown'], ['stage', 'select'], ['tags_list', 'multiselect'],
    ['owner_id', 'lookup'], ['assignee', 'user'], ['payload', 'json'], ['attachment', 'file'],
    ['where_at', 'location'], ['margin', 'formula'], ['case_no', 'autonumber'], ['embedding', 'vector'],
  ];

  for (const aggregate of ['sum', 'avg'] as const) {
    for (const [field, declared] of REFUSED_FOR_BOTH) {
      it(`${aggregate} × \`${declared}\` → DATASET_INVALID / 400, before any SQL`, async () => {
        // Guard against a vacuous case: if the table ever ACCEPTED this pair,
        // the expectation below would be asserting the wrong contract.
        expect(isAggregateCompatibleWithFieldType(aggregate, declared)).toBe(false);
        const { go, sqls } = run(aggregate, field);
        const err = await refusalOf(go);
        expect(err.code).toBe('DATASET_INVALID');
        expect(err.status).toBe(400);
        // The message locates the fault for the author who wrote the pair.
        expect(err.message).toContain('probe_measure');
        expect(err.message).toContain(field);
        expect(err.message).toContain(declared);
        // …and names the accepted set off the table rather than restating it.
        for (const accepted of AGGREGATE_FIELD_TYPE_COMPATIBILITY[aggregate]) {
          expect(err.message).toContain(accepted);
        }
        // Refused as a DECLARATION: nothing reached the driver. This is the
        // assertion that fails if the gate is removed, because the compile then
        // succeeds and a statement IS emitted.
        expect(sqls.length).toBe(0);
      });
    }
  }

  it('⭐ `sum` × `percent` is refused while `avg` × `percent` still compiles — a ROW, not a class', async () => {
    const refused = run('sum', 'win_rate');
    const err = await refusalOf(refused.go);
    expect(err.code).toBe('DATASET_INVALID');
    expect(refused.sqls.length).toBe(0);

    const accepted = run('avg', 'win_rate', [{ status: 'open', probe_measure: 0.42 }]);
    const result: any = await accepted.go();
    expect(result.rows.length).toBe(1);
    expect(accepted.sqls.length).toBe(1);
  });

  it('the non-numeric remedy is the one a non-temporal refusal prints', async () => {
    const err = await refusalOf(run('sum', 'note').go);
    expect(err.message).toContain('count_distinct');
    expect(err.message).not.toContain('real instant');
  });

  it('a TEMPORAL refusal keeps #16778\'s own remedy sentence — continuity control', async () => {
    const err = await refusalOf(run('avg', 'submitted_at').go);
    expect(err.code).toBe('DATASET_INVALID');
    expect(err.message).toContain('real instant');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The negative controls — what must NOT move
// ─────────────────────────────────────────────────────────────────────────────

describe('#16099 — the controls: every pair the table accepts still compiles', () => {
  for (const [field, declared] of [
    ['cycle_days', 'number'], ['amount', 'currency'], ['score', 'rating'],
    ['child_total', 'summary'], ['is_urgent', 'boolean'], ['flagged', 'toggle'],
  ] as const) {
    for (const aggregate of ['sum', 'avg'] as const) {
      it(`${aggregate} × \`${declared}\` still reaches the driver`, async () => {
        expect(isAggregateCompatibleWithFieldType(aggregate, declared)).toBe(true);
        const { go, sqls } = run(aggregate, field);
        const result: any = await go();
        expect(result.rows.length).toBe(1);
        expect(sqls.length).toBe(1);
      });
    }
  }

  it('⭐ `min` / `max` ARE judged by this gate now — the pin FLIPPED, naming batch #59 and #17560', async () => {
    // ⚠️ This case asserted the OPPOSITE until #17560, over exactly these pairs:
    // "`min` / `max` are NOT judged by this gate — #17513's population,
    // untouched", and its own comment predicted in writing that it "goes red if
    // a later change widens the gate past the deriving aggregates WITHOUT
    // MOVING THAT RULING FIRST". The ruling moved first: decision batch #127
    // (2026-09-13, #17560) found that the "ruled C" the tree cited had no
    // ruling behind it, that the one recorded ruling on this table — decision
    // batch #59 (2026-09-06) — refuses these rows, and that all 74 unenforced
    // `min` / `max` pairs are refused and enforced in one pass. ⛔ So the pin is
    // FLIPPED rather than deleted: the same pairs, through the same door,
    // asserting the answer the platform now gives.
    for (const aggregate of ['min', 'max'] as const) {
      for (const [field, declared] of [
        ['note', 'text'], ['stage', 'select'], ['owner_id', 'lookup'], ['case_no', 'autonumber'],
        ['payload', 'json'], ['margin', 'formula'], ['tags_list', 'multiselect'],
      ] as const) {
        // Not vacuous: if the table ever ACCEPTED one of these the expectation
        // below would be asserting the wrong contract.
        expect(isAggregateCompatibleWithFieldType(aggregate, declared), `${aggregate} × ${declared}`).toBe(false);
        const { go, sqls } = run(aggregate, field, [{ status: 'open', probe_measure: 'x' }]);
        const err = await refusalOf(go);
        expect(err.code, `${aggregate} × ${declared}`).toBe('DATASET_INVALID');
        expect(err.status, `${aggregate} × ${declared}`).toBe(400);
        expect(err.message).toContain(declared);
        // Refused BEFORE the driver — the assertion that would catch a gate
        // that "refused" by returning an empty result instead.
        expect(sqls.length, `${aggregate} × ${declared}`).toBe(0);
      }
    }
  });

  it('⭐ the negative control on the same axis: `min` / `max` over an ACCEPTED type still compiles', async () => {
    // The case that fails if the widened gate started refusing everything
    // rather than exactly what the table refuses.
    for (const aggregate of ['min', 'max'] as const) {
      for (const [field, declared] of [
        ['cycle_days', 'number'], ['amount', 'currency'], ['submitted_at', 'datetime'],
        ['is_urgent', 'boolean'], ['child_total', 'summary'],
      ] as const) {
        expect(isAggregateCompatibleWithFieldType(aggregate, declared), `${aggregate} × ${declared}`).toBe(true);
        const { go, sqls } = run(aggregate, field, [{ status: 'open', probe_measure: 1 }]);
        const result: any = await go();
        expect(result.rows.length, `${aggregate} × ${declared}`).toBe(1);
        expect(sqls.length, `${aggregate} × ${declared}`).toBe(1);
      }
    }
  });

  it('the SELECTING remedy is the one a `min` / `max` refusal prints — not the deriving one', async () => {
    // The messages are not interchangeable: `sum` over a text column diverges
    // on ARITHMETIC, `min` over one diverges on ORDER, and the prescription
    // differs with it (store a number vs sort the record list).
    const err = await refusalOf(run('min', 'note').go);
    expect(err.message).toContain('SELECTS one of the stored values');
    expect(err.message).toContain('collation-dependent');
    expect(err.message).not.toContain('derives a NUMBER');
  });

  it('`count` / `count_distinct` accept every type — they read no arithmetic off the value', async () => {
    for (const aggregate of ['count', 'count_distinct'] as const) {
      const { go, sqls } = run(aggregate, 'note');
      const result: any = await go();
      expect(result.rows.length).toBe(1);
      expect(sqls.length).toBe(1);
    }
  });

  it('the three cannot-answer tiers still do not block — unchanged by the widened scope', async () => {
    // 1. a field the hook cannot resolve
    const unknown = run('sum', 'no_such_field');
    const r1: any = await unknown.go();
    expect(r1.rows.length).toBe(1);
    expect(unknown.sqls.length).toBe(1);

    // 2. a dotted relationship path — the hook answers for the BASE object
    const sqls: string[] = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_o: string, sql: string) => { sqls.push(sql); return [{ status: 'open', probe_measure: 1 }]; },
      sourceFieldMeta: (_o: string, f: string) => (FIELD_TYPES[f] ? { type: FIELD_TYPES[f] } : undefined),
    } as never);
    const rel = DatasetSchema.parse({
      name: 'task_metrics_rel', label: 'Task metrics', object: 'duly_task', include: ['account'],
      dimensions: [{ name: 'status', field: 'status', type: 'string' }],
      measures: [{ name: 'probe_measure', aggregate: 'sum', field: 'account.note' }],
    });
    const r2: any = await svc.queryDataset(rel as never, { dimensions: ['status'], measures: ['probe_measure'] } as never);
    expect(r2.rows.length).toBe(1);

    // 3. no `declaredFieldType` hook at all (no data engine wired)
    const bare: string[] = [];
    const noMeta = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_o: string, sql: string) => { bare.push(sql); return [{ status: 'open', probe_measure: 1 }]; },
    } as never);
    const r3: any = await noMeta.queryDataset(
      dataset('sum', 'note') as never,
      { dimensions: ['status'], measures: ['probe_measure'] } as never,
    );
    expect(r3.rows.length).toBe(1);
    expect(bare.length).toBe(1);
  });
});
