// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6387, applying #5347 / #5369] A non-boolean `$null` / `$exists` comparand in
 * a READ SCOPE is refused — `READ_SCOPE_COMPILE_FAILED` / 500 — and a boolean
 * one is untouched.
 *
 * ## What was wrong
 *
 * `compileOperator` read both flags by plain TRUTHINESS (`val ? … : …`), so
 * every non-boolean was silently sorted into one of the two declared answers
 * instead of being refused. Measured on `origin/main` (`5faa23ca3`) by calling
 * `compileScopedFilterToSql` directly, alias `t`:
 *
 * | read scope | compiled to | |
 * |---|---|---|
 * | `{ owner_id: { $null: "false" } }`   | `"t"."owner_id" IS NULL`     | ⛔ opposite |
 * | `{ owner_id: { $null: "true" } }`    | `"t"."owner_id" IS NULL`     | |
 * | `{ owner_id: { $null: 0 } }`         | `"t"."owner_id" IS NOT NULL` | |
 * | `{ owner_id: { $null: null } }`      | `"t"."owner_id" IS NOT NULL` | |
 * | `{ owner_id: { $null: undefined } }` | `"t"."owner_id" IS NOT NULL` | |
 * | `{ owner_id: { $exists: "false" } }` | `"t"."owner_id" IS NOT NULL` | ⛔ opposite |
 * | `{ owner_id: { $exists: 0 } }`       | `"t"."owner_id" IS NULL`     | |
 * | `{ owner_id: { $exists: "no" } }`    | `"t"."owner_id" IS NOT NULL` | |
 *
 * The two ⛔ rows are the defect. The string `"false"` is TRUTHY, so a scope
 * written to mean "rows with NO owner" compiled to "rows that HAVE one" — this
 * module ADMITTING the rows the policy excludes, in a compiler whose own header
 * promises "a read-scope predicate must never be silently dropped". Unlike
 * #6125's cell (fail-closed, zero rows, merely silent) this direction WIDENS,
 * which is why it needed no fresh judgement: #5347 (`$null`) and #5369
 * (`$exists`) already refused the shape on `driver-sql` and their reason
 * transfers word for word.
 *
 * ## ⚠️ Reachability, measured — the half that came back NEGATIVE
 *
 * #6387 required a decisive answer to "can `{ $null: <non-boolean> }` reach this
 * compiler from STORED metadata". Measured, it cannot, and that is recorded here
 * because the issue's severity argument rested on the opposite:
 *
 *   1. `RowLevelSecurityPolicySchema` declares `using` / `check` as `z.string()`
 *      (a CEL predicate, not a `FilterCondition`). Storing an object is rejected:
 *      `expected string, received object`.
 *   2. `@objectstack/formula`'s `cel-to-filter.ts` emits `$null` at exactly two
 *      sites, both with a HARD-CODED boolean (`== null` → `{ $null: true }`,
 *      `!= null` → `{ $null: false }`), and emits `$exists` nowhere at all. An
 *      unresolved `current_user.*` yields `unresolved-variable`, dropping the
 *      policy to the deny sentinel rather than producing a stray comparand.
 *   3. Bypassing the schema does not help: a raw object predicate throws inside
 *      `sqlPredicateToCel` (`expression.replace is not a function`) and
 *      `getReadFilter`'s catch converts that to `RLS_DENY_FILTER`; a JSON STRING
 *      of a FilterCondition stores fine and then fails to parse as CEL → deny.
 *
 * The other read-scope producers cannot emit it either (Layer 0 tenant filter,
 * `plugin-sharing`'s `buildReadFilter`, the controlled-by-parent filter,
 * `RLS_DENY_FILTER` — none contains `$null` or `$exists`). What IS open:
 * `getReadScope` is a documented public option on `AnalyticsPluginOptions`, so a
 * host supplying its own read scope from JSON config or untyped JS is a live
 * producer with no gate in between — and #6387 confirmed the issue's other
 * measurement, that `plugin-security` runs no `FilterConditionSchema` /
 * `safeParse` anywhere on this path. So: not reachable from stored metadata
 * today, nothing structural stopping the next producer.
 *
 * ## The three parts of this file
 *
 * `describe('the eight measured cells …')` is the change: run it against
 * pre-#6387 code and every row fails, because every row COMPILES.
 *
 * `describe('the boolean control group …')` is the risk. `true` / `false` are
 * the declared domain and `IS NULL` lowering is precisely what an RLS policy
 * uses to scope unowned rows, so the way this change could do harm is by
 * refusing a correct policy. Every row there passes before AND after, SQL and
 * binds byte for byte.
 *
 * `describe('the polarity table …')` covers the second half of the change —
 * `nullValueSatisfiesOperator`'s `$null` / `$exists` arms moving from truthiness
 * to identity — and is honest about what can and cannot be observed from
 * outside; see its own comment.
 */

import { describe, it, expect } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

/** The ADR-0112 fields an HTTP boundary classifies on. */
interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

const ALIAS = 't';

function refusalFor(filter: FilterCondition): Refusal | undefined {
  try {
    compileScopedFilterToSql(filter, ALIAS);
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

/** Every non-boolean comparand #6387 measured, with the lowering it used to get. */
const REFUSED: Array<{ op: '$null' | '$exists'; label: string; comparand: unknown; wasSql: string }> = [
  { op: '$null', label: 'the STRING "false" — truthy, so the OPPOSITE side', comparand: 'false', wasSql: '"t"."d" IS NULL' },
  { op: '$null', label: 'the string "true"', comparand: 'true', wasSql: '"t"."d" IS NULL' },
  { op: '$null', label: 'the number 0', comparand: 0, wasSql: '"t"."d" IS NOT NULL' },
  { op: '$null', label: 'null', comparand: null, wasSql: '"t"."d" IS NOT NULL' },
  { op: '$null', label: 'undefined (#6390 pinned this one as the cell left alone)', comparand: undefined, wasSql: '"t"."d" IS NOT NULL' },
  { op: '$exists', label: 'the STRING "false" — truthy, so the OPPOSITE side', comparand: 'false', wasSql: '"t"."d" IS NOT NULL' },
  { op: '$exists', label: 'the number 0', comparand: 0, wasSql: '"t"."d" IS NULL' },
  { op: '$exists', label: 'the string "no"', comparand: 'no', wasSql: '"t"."d" IS NOT NULL' },
  { op: '$exists', label: 'undefined (#6390 pinned this one as the cell left alone)', comparand: undefined, wasSql: '"t"."d" IS NULL' },
];

const flag = (op: string, comparand: unknown): FilterCondition =>
  ({ d: { [op]: comparand } }) as FilterCondition;

/**
 * The DECLARED domain — the control group, and the reason it is spelled out per
 * operator rather than assumed.
 *
 * `$null: true` is how an RLS policy scopes to unowned rows and `$exists: false`
 * is its mirror; a gate written one predicate wider (`!== true`, say, or a
 * `typeof` test that forgets `false` is a boolean) takes this whole table with
 * it, and takes it with a 500 on a policy that is correct. These four rows are
 * also the four the CEL lowering can actually produce, so they are the only
 * `$null` shapes reachable from stored metadata at all.
 */
const BOOLEAN_CONTROL: Array<{ name: string; filter: FilterCondition; sql: string }> = [
  { name: '{ $null: true }', filter: { d: { $null: true } }, sql: '"t"."d" IS NULL' },
  { name: '{ $null: false }', filter: { d: { $null: false } }, sql: '"t"."d" IS NOT NULL' },
  { name: '{ $exists: true }', filter: { d: { $exists: true } }, sql: '"t"."d" IS NOT NULL' },
  { name: '{ $exists: false }', filter: { d: { $exists: false } }, sql: '"t"."d" IS NULL' },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#6387] the eight measured cells are REFUSED, in this module’s own envelope', () => {
  for (const c of REFUSED) {
    it(`refuses ${c.op} with ${c.label}`, () => {
      const err = refusalFor(flag(c.op, c.comparand));
      expect(err, `it still COMPILED — pre-#6387 this lowered to ${c.wasSql}`).toBeInstanceOf(Error);
      expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
      // 500, not #5347's `INVALID_FILTER` / 400: a read scope is compiled by the
      // platform from CEL and stored metadata, so the caller is not its author.
      // The precedent transferred is the DISPOSITION (refuse), not the envelope
      // — this module has exactly one, and #6125 reused it for the same reason.
      expect(err?.status).toBe(500);
      expect(err?.code).not.toBe('INVALID_FILTER');
    });

    it(`names the operator and the position: "d".${c.op}`, () => {
      const msg = String(refusalFor(flag(c.op, c.comparand))?.message);
      expect(msg).toContain(`comparand for "${c.op}" at "d".${c.op} is not a boolean`);
    });

    it(`no longer emits its old lowering: ${c.op} → ${c.wasSql}`, () => {
      // The other direction of the same fact. A refusal thrown for some unrelated
      // reason would satisfy the assertions above; this one fails if the pre-#6387
      // SQL ever comes back, whatever else the module does.
      let sql: string | undefined;
      try {
        sql = compileScopedFilterToSql(flag(c.op, c.comparand), ALIAS).sql;
      } catch {
        sql = undefined;
      }
      expect(sql).toBeUndefined();
    });
  }

  it('says it ONE way — only the operator name and the path differ (#5240)', () => {
    // Two operators, one sentence. `driver-sql` gives its twins two messages
    // because each names the direction ITS OWN emitter defaulted to; this module
    // had a single rule (truthiness) covering both, so both failed identically
    // and one wording is the honest spelling. If a later change gives one of them
    // a bespoke phrasing, this is the line that objects.
    const skeletons = REFUSED.map((c) => {
      const msg = String(refusalFor(flag(c.op, c.comparand))?.message);
      return msg.split(`"${c.op}"`).join('"<op>"').split(`"d".${c.op}`).join('"d".<op>');
    });
    expect(new Set(skeletons).size).toBe(1);
    expect(skeletons[0]).toContain('comparand for "<op>" at "d".<op> is not a boolean');
    // …and the shared sentence still carries the fact that made the two ⛔ rows
    // the defect, rather than being generic enough to fit anything.
    expect(skeletons[0]).toContain('The string "false" is TRUTHY');
  });

  it('the message tells the operator to fix the PRODUCER, not the caller', () => {
    // The disclosure/attribution half of #5367: the message is for the log, and
    // what it must not do is send a tenant to "fix their request".
    const msg = String(refusalFor(flag('$null', 'false'))?.message);
    expect(msg).toContain('never the caller of this query');
    expect(msg).toContain('sharing rule');
    // The in-process producer measured as the one that IS open, named so the
    // operator has somewhere to look when no sharing rule is involved.
    expect(msg).toContain('getReadScope');
  });

  it('refuses through every route into compileField, not just the flat one', () => {
    // `compileField` is the one road every field constraint travels — the
    // evaluation-order trap #5348 / #5327 named on the driver side does not
    // exist here, and these four assertions are what says so out loud.
    expect(refusalFor({ $not: { d: { $null: 'false' } } })?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(refusalFor({ $or: [{}, { d: { $exists: 'false' } }] })?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(refusalFor({ $and: [{}, { d: { $null: 0 } }] })?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    // Mixed with a legitimate operator on the same field — the constraint is the
    // AND of its operators, so one bad flag refuses the whole field.
    expect(refusalFor({ d: { $null: 'false', $ne: 'x' } })?.code).toBe('READ_SCOPE_COMPILE_FAILED');
  });

  it('an INHERITED $null cannot trip the gate', () => {
    // `hasOwnProperty`, not `in` — matching `driver-sql`'s twin line for line.
    // A prototype-borne key is not something an author wrote.
    const spec = Object.create({ $null: 'false' }) as Record<string, unknown>;
    spec.$eq = 'u1';
    expect(compileScopedFilterToSql({ d: spec } as FilterCondition, ALIAS).sql).toBe('"t"."d" = ?');
  });
});

describe('[#6387] the boolean control group is UNTOUCHED — SQL byte for byte', () => {
  for (const c of BOOLEAN_CONTROL) {
    it(`still compiles: ${c.name}`, () => {
      const out = compileScopedFilterToSql(c.filter, ALIAS);
      expect(out.sql).toBe(c.sql);
      expect(out.params).toEqual([]);
    });
  }

  it('the two flags are still each other’s mirror', () => {
    // `$null: true` and `$exists: false` are the same question. The identity
    // spelling that replaced truthiness had to preserve that, and a sign error
    // in either emitter arm shows up here rather than as a subtly wrong scope.
    const sql = (f: FilterCondition) => compileScopedFilterToSql(f, ALIAS).sql;
    expect(sql({ d: { $null: true } })).toBe(sql({ d: { $exists: false } }));
    expect(sql({ d: { $null: false } })).toBe(sql({ d: { $exists: true } }));
  });

  it('a boolean flag and a refused one are told apart at the SAME position', () => {
    expect(compileScopedFilterToSql({ d: { $null: false } }, ALIAS).sql).toBe('"t"."d" IS NOT NULL');
    expect(refusalFor({ d: { $null: 'false' } })?.code).toBe('READ_SCOPE_COMPILE_FAILED');
  });
});

describe('[#6387] the polarity table moved WITH the emitter (#5146 / #5298)', () => {
  /**
   * ⚠️ Read this before adding an assertion that "proves" the table changed.
   *
   * `nullValueSatisfiesOperator`'s `$null` / `$exists` arms went from truthiness
   * (`Boolean(value)` / `!value`) to identity (`value === true` /
   * `value === false`) in this change, because a polarity table pins the
   * spelling of ITS OWN emitter — leaving them truthy while the emitter stopped
   * guessing is how that invariant breaks silently at its own definition, which
   * is the trap #6387 called out in advance.
   *
   * The honest part: that edit is NOT independently observable from outside, and
   * pretending otherwise would be a test that passes for the wrong reason. The
   * gate refuses every value on which the two spellings disagree, and over the
   * two that survive — `true` and `false` — truthiness and identity give the
   * same answer. So what is observable is the table's PRECONDITION, and that is
   * what these three assertions pin:
   *
   *   - the boolean rows still route through `$not` exactly as before (the
   *     control group for the tightening — it did no harm), and
   *   - a non-boolean can never have the table's verdict SURVIVE, whichever way
   *     the rewrite classifies it, because the rewritten leaf still reaches
   *     `compileField` and is refused there.
   */
  const sql = (f: FilterCondition) => compileScopedFilterToSql(f, ALIAS).sql;

  it('allowNull polarity: a NULL column satisfies $null: true', () => {
    // `$nin` makes the constraint non-total, so `nullGuardForFieldSpec` has to
    // consult the table; `$null: true` says a NULL row DOES satisfy it, so the
    // leaf is guarded with `IS NULL OR (…)`.
    expect(sql({ $not: { d: { $null: true, $nin: ['x'] } } })).toBe(
      'NOT ((("t"."d" IS NULL OR ("t"."d" IS NULL AND ("t"."d" IS NULL OR "t"."d" NOT IN (?))))))',
    );
  });

  it('requireValue polarity: a NULL column does NOT satisfy $null: false', () => {
    expect(sql({ $not: { d: { $null: false, $nin: ['x'] } } })).toBe(
      'NOT (("t"."d" IS NOT NULL AND ("t"."d" IS NOT NULL AND ("t"."d" IS NULL OR "t"."d" NOT IN (?)))))',
    );
  });

  it('$exists is the mirror of $null at the same position', () => {
    // `$exists: false` asks the same question as `$null: true`, so it must pick
    // the same GUARD, not merely the same leaf SQL — the two arms of the table
    // are each other's mirror and a copy-paste that made them equal would show
    // up as the wrong guard on one of these two lines.
    expect(sql({ $not: { d: { $exists: false, $nin: ['x'] } } })).toBe(sql({ $not: { d: { $null: true, $nin: ['x'] } } }));
    expect(sql({ $not: { d: { $exists: true, $nin: ['x'] } } })).toBe(sql({ $not: { d: { $null: false, $nin: ['x'] } } }));
  });

  it('the table can never answer for a value outside the domain', () => {
    // The rewrite runs BEFORE `compileField`, so a non-boolean IS classified by
    // the table on the way through. This is the assertion that says the
    // classification is DISCARDED: whichever guard it chose, the rewritten leaf
    // still carries the bad flag into `compileField` and is refused there. Both
    // guard directions are exercised — `$null` and `$exists` sit on opposite
    // sides of the identity test for the same comparand.
    for (const op of ['$null', '$exists'] as const) {
      for (const comparand of ['false', 'true', 0, 1, null, undefined]) {
        const err = refusalFor({ $not: { d: { [op]: comparand, $nin: ['x'] } } } as FilterCondition);
        expect(err?.code, `${op}: ${String(comparand)} escaped through the $not rewrite`).toBe(
          'READ_SCOPE_COMPILE_FAILED',
        );
      }
    }
  });
});
