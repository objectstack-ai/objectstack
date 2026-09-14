// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17343 · retargeted by #17469] The declared-type gate never fires on a JSON
 * column — and the population of JSON columns is now the one the protocol
 * declares.
 *
 * ## What this file was filed for, and what happened to it
 *
 * #17343: a `multiple: true` BOOLEAN column lost its `$contains` MEMBERSHIP
 * filter — the carve-out #14079's declared-type gate never received on its
 * boolean limb, while its numeric limb carried one from the first line it
 * shipped and its temporal limb gained one in #15683. `{ FIELD: { $contains:
 * 'true' } }` compiled `where 1 = 0` over a multi-valued boolean: the
 * fail-CLOSED direction #7398's own table calls out, byte-identical to a filter
 * that legitimately matched nothing.
 *
 * The card's fourth reading of WHY the exclusion existed was, verbatim:
 *
 * > `boolean` + `multiple: true` is authorable — `FieldSchema.multiple` refuses
 * > exactly one type (`radio`) — and this driver already gives it a JSON
 * > column, a faithful array write and a working `$contains` on every OTHER
 * > multi-valued class.
 *
 * ⭐ **That premise is retired.** The maintainer ruling of 2026-09-13 (decision
 * batch #128 item 5, option 1′, on #17469) gives "multi-valued" exactly ONE
 * definition — `isMultiValueField` — refuses `multiple: true` at the authoring
 * entrance on every type outside `MULTI_CAPABLE_TYPES` ∪ `MULTI_OPTION_TYPES`,
 * and makes this driver's storage decision derive from that same predicate. So
 * a multi-valued BOOLEAN, TOGGLE, NUMBER or DATETIME column is no longer
 * authorable and is no longer a JSON column here: the declared-type gate fires
 * on it exactly as it fires on the scalar beside it, which is correct, because
 * the column now really does store one scalar.
 *
 * ## What survives, and why this file is not vacuous
 *
 * The invariant is unchanged and still has a population: **the declared-type
 * gate never fires on a JSON column.** What moved is which declarations produce
 * one. Every row below is asserted on a shape that exists after the ruling —
 * a multi-valued `select` / `lookup`, and the inherently-multi `tags` — plus
 * two pins of the ruling itself, so a revert on EITHER side reddens this file:
 *
 *   1. `FieldSchema` refuses the retired declarations (the entrance half);
 *   2. the driver stops giving them a JSON column (the storage half).
 *
 * ⛔ Do not restore a `{ type: 'boolean', multiple: true }` fixture to "keep the
 * original cell". It would pin a branch the writer no longer has, and it would
 * pass for the wrong reason: the gate fires, the answer is empty, and an empty
 * answer is what the original defect looked like.
 *
 * ## Which cells executed
 *
 *   - **sqlite** — always, embedded.
 *   - **live mysql / live postgres** — run when provisioned. #17590's ruling
 *     (2026-09-12) replaced the text lowering with a real MEMBERSHIP construct
 *     compiled per dialect, so all three answer the same rows and this file
 *     carries no per-dialect branch.
 *
 * @see SqlDriver.isNonTextColumn — the predicate; its JSON carve-out is the invariant.
 * @see SqlDriver.isJsonField — the storage half of the #17469 ruling.
 * @see https://github.com/objectstack-ai/objectstack/issues/17469 (the ruling that retargeted this file)
 * @see https://github.com/objectstack-ai/objectstack/issues/17343
 * @see https://github.com/objectstack-ai/objectstack/issues/14079 (the gate)
 * @see https://github.com/objectstack-ai/objectstack/issues/15683 (the temporal carve-out)
 * @see https://github.com/objectstack-ai/objectstack/issues/7398 (the membership spelling it protects)
 * @see https://github.com/objectstack-ai/objectstack/issues/17590 (the membership construct)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { FieldSchema, NON_TEXT_STORED_VALUE_TYPES } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** Issue-prefixed: the live cells share one database with every other suite here. */
const MULTI_OBJECT = 'os17343_multi_boolean';

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

/**
 * The fixture shape, after #17469.
 *
 * `picks` / `refs` are multi-valued by `isMultiValueField` and therefore JSON
 * columns — the cell the invariant now owns. `tags_` is the inherently-multi
 * option type beside them. `scalar_flag` / `scalar_toggle` are the NEGATIVE
 * controls: the gate must still fire on them, or the carve-out is a hole in the
 * gate rather than a reading of the storage shape. `retired_flags` is the
 * RULING's own pin — the declaration the entrance refuses, which reaches this
 * driver only through a hand-built fixture like this one and is a plain boolean
 * column when it does.
 */
const MULTI_FIELDS: Record<string, Record<string, unknown>> = {
  label: { type: 'string' },
  picks: { type: 'select', multiple: true },
  refs: { type: 'lookup', multiple: true },
  tags_: { type: 'tags' },
  scalar_flag: { type: 'boolean' },
  scalar_toggle: { type: 'toggle' },
  retired_flags: { type: 'boolean', multiple: true },
};

/**
 * Rows chosen so the membership filter has a real job: `red` is a member of row
 * 1's and row 3's `tags_` and NOT of row 2's, so a gate that silently fails to
 * fire returns a WRONG set rather than the same empty list a fired gate returns.
 */
const MULTI_ROWS = [
  { id: '1', label: 'alpha', picks: ['a', 'b'], refs: ['r1', 'r2'], tags_: ['red'], scalar_flag: true, scalar_toggle: true, retired_flags: true },
  { id: '2', label: 'beta', picks: ['c'], refs: ['r3'], tags_: ['blue'], scalar_flag: false, scalar_toggle: false, retired_flags: false },
  { id: '3', label: 'gamma', picks: ['a'], refs: ['r1'], tags_: ['red', 'blue'], scalar_flag: true, scalar_toggle: false, retired_flags: true },
] as const;

const POSITIVE_OPERATORS = ['$contains', '$startsWith', '$endsWith', '$icontains', '$like', '$ilike'] as const;

/** The declarations #17469 retired, read from the spec sets rather than listed. */
const RETIRED_MULTI_TYPES = [...NON_TEXT_STORED_VALUE_TYPES].sort();

describe('[#17469] the entrance half — the declarations this file used to pin are REFUSED', () => {
  it('`FieldSchema` refuses `multiple: true` on every declared non-text class', () => {
    expect(RETIRED_MULTI_TYPES.length, 'the swept population').toBeGreaterThan(8);
    for (const type of RETIRED_MULTI_TYPES) {
      const r = FieldSchema.safeParse({ name: 'several', type, multiple: true });
      expect(r.success, `\`${type}\` + multiple: true must be refused at the entrance`).toBe(false);
    }
  });

  it('…and still accepts the multi-capable declarations this file now uses — the negative control', () => {
    expect(FieldSchema.safeParse({ name: 'refs', type: 'lookup', reference: 'account', multiple: true }).success).toBe(true);
    expect(FieldSchema.safeParse({
      name: 'picks', type: 'select', multiple: true,
      options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
    }).success).toBe(true);
  });
});

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, '[#17343] the JSON-column membership filter');
    continue;
  }
  declareMembershipSweep(cell);
}

/**
 * The `initObjects` REGISTRY FILL, executed. This is the second of the two
 * fills — a repair applied to `registerExternalObject` alone would leave this
 * one live — and it is also the only layer that can say the membership filter
 * ANSWERS, rather than merely compiling to something other than a constant.
 */
function declareMembershipSweep(cell: DialectCell): void {
  describe(`[#17343] SqlDriver — $contains over a JSON column (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = driver.getKnex();
      await knexInstance.schema.dropTableIfExists(MULTI_OBJECT);
      await driver.initObjects([{ name: MULTI_OBJECT, fields: MULTI_FIELDS } as never]);
      for (const row of MULTI_ROWS) await driver.create(MULTI_OBJECT, { ...row }, BYPASS);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(MULTI_OBJECT).catch(() => {});
      await driver?.disconnect?.();
    });

    const ids = async (where: FilterCondition): Promise<string[]> => {
      const rows = await driver.find(MULTI_OBJECT, { where }, BYPASS);
      return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
    };

    /**
     * The fixture control. Without it every empty answer below has a second
     * possible cause that has nothing to do with the gate — the classic
     * vacuous green.
     */
    it('stored all three rows — the premise of every answer below', async () => {
      const rows = await driver.find(MULTI_OBJECT, {}, BYPASS);
      expect(rows.map((r) => String(r.id)).sort()).toEqual(['1', '2', '3']);
    });

    it('$contains over a multi-valued SELECT answers the rows whose array holds that member', async () => {
      expect(await ids({ picks: { $contains: 'a' } })).toEqual(['1', '3']);
      expect(await ids({ picks: { $contains: 'c' } })).toEqual(['2']);
    });

    it('$contains over a multi-valued LOOKUP answers identically — same storage shape', async () => {
      expect(await ids({ refs: { $contains: 'r1' } })).toEqual(['1', '3']);
      expect(await ids({ refs: { $contains: 'r3' } })).toEqual(['2']);
    });

    it('the inherently-multi `tags` column beside them is unmoved', async () => {
      expect(await ids({ tags_: { $contains: 'red' } })).toEqual(['1', '3']);
      expect(await ids({ tags_: { $contains: 'blue' } })).toEqual(['2', '3']);
    });

    /**
     * The negative control, and the reason this is a carve-out rather than a
     * hole. A SCALAR boolean is still a declared non-text column, so every
     * positive text operator still answers the declared no-match and
     * `$notContains` its exact complement.
     *
     * ⭐ [#17469] `retired_flags` is in the same loop on purpose: a `boolean`
     * carrying `multiple: true` is NOT multi-valued any more, so it is a plain
     * boolean column and the gate fires on it identically. That is the storage
     * half of the ruling, asserted where it is observable.
     */
    it('the SCALAR boolean/toggle — and the RETIRED multi-valued boolean — are gated alike', async () => {
      for (const field of ['scalar_flag', 'scalar_toggle', 'retired_flags']) {
        for (const op of POSITIVE_OPERATORS) {
          expect(await ids({ [field]: { [op]: 'true' } } as FilterCondition), `${op} over ${field}`).toEqual([]);
        }
        expect(await ids({ [field]: { $notContains: 'true' } } as FilterCondition), `$notContains over ${field}`)
          .toEqual(['1', '2', '3']);
      }
    });
  });
}

/**
 * The construct each dialect compiles to, decided WITHOUT a server — the only
 * layer that can say anything about MySQL when no server is provisioned, and
 * the layer that covers the OTHER registry fill (`registerExternalObject`).
 */
describe('[#17343] the per-dialect construct, compiled — the registerExternalObject fill', () => {
  class CompilerProbeDriver extends SqlDriver {
    compileWhere(where: FilterCondition): string {
      const builder: Knex.QueryBuilder = this.getKnex()(MULTI_OBJECT);
      this.applyFilters(builder, where);
      return builder.toString();
    }

    declareMulti(fields: Record<string, Record<string, unknown>> = MULTI_FIELDS): this {
      this.registerExternalObject({ name: MULTI_OBJECT, fields } as never);
      return this;
    }
  }

  const DIALECTS: Array<[string, SqlDriverConfig]> = [
    ['sqlite', { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }],
    ['postgres', { client: 'pg', connection: { host: '127.0.0.1' } }],
    ['mysql', { client: 'mysql2', connection: { host: '127.0.0.1' } }],
  ];
  const typed = (config: SqlDriverConfig) => new CompilerProbeDriver(config).declareMulti();

  /**
   * [#17590] "A real predicate over the column" per dialect — the pattern
   * emitter OR the membership construct that replaced it for `$contains`. This
   * file's question is whether the declared-type gate fired, so it must accept
   * either; asserting one SHAPE here would make it red on the card that changes
   * the other, which is exactly what #17590 did to its predecessor.
   */
  const REAL_PREDICATE: Record<string, RegExp> = {
    sqlite: /LIKE|GLOB|json_each\(/,
    postgres: /LIKE|GLOB|::jsonb @> /,
    mysql: /LIKE|GLOB|JSON_CONTAINS\(/,
  };

  for (const [label, config] of DIALECTS) {
    it(`${label}: a multi-valued select/lookup compiles a real predicate, never the constant`, () => {
      const d = typed(config);
      for (const field of ['picks', 'refs']) {
        for (const op of POSITIVE_OPERATORS) {
          const sql = d.compileWhere({ [field]: { [op]: 'x' } } as FilterCondition);
          expect(sql, `${op} over ${field}`).not.toMatch(/1 = 0|1 = 1/);
          // [#17590] `$contains` compiles the MEMBERSHIP construct now and the
          // rest of the family still compiles a pattern match. What this card
          // is about is neither shape — it is that the declared-type gate does
          // not fire — so this row asks for "a real predicate over the column",
          // and the SHAPE per operator is owned by #17590's own file.
          expect(sql, `${op} over ${field}`).toMatch(REAL_PREDICATE[label]!);
        }
      }
    });

    it(`${label}: the scalar boolean/toggle — and the retired multi-valued one — compile the declared constants`, () => {
      const d = typed(config);
      for (const field of ['scalar_flag', 'scalar_toggle', 'retired_flags']) {
        for (const op of POSITIVE_OPERATORS) {
          const sql = d.compileWhere({ [field]: { [op]: 'true' } } as FilterCondition);
          expect(sql, `${op} over ${field}`).toMatch(/where 1 = 0/);
          expect(sql, `${op} over ${field}`).not.toMatch(/LIKE|GLOB|lower\(|CAST\(/);
        }
        expect(d.compileWhere({ [field]: { $notContains: 'true' } } as FilterCondition), field)
          .toMatch(/where 1 = 1/);
      }
    });

    it(`${label}: the positive controls still compile a real predicate`, () => {
      const d = typed(config);
      for (const field of ['tags_', 'label']) {
        expect(d.compileWhere({ [field]: { $contains: 'red' } } as FilterCondition), field)
          .toMatch(REAL_PREDICATE[label]!);
      }
      // …and the SCALAR string column among them is the one still on the pattern
      // emitter, which is what keeps the row above from passing vacuously.
      expect(d.compileWhere({ label: { $contains: 'red' } } as FilterCondition)).toMatch(/LIKE|GLOB/);
    });
  }

  /**
   * The two registry fills, compiled side by side on one dialect. The
   * asymmetry this card repairs was present in BOTH, so a repair reaching only
   * one of them leaves the defect live on the other — and the two fills are
   * separate code with no shared helper to make that impossible.
   */
  it('BOTH registry fills agree — initObjects and registerExternalObject compile the same construct', async () => {
    const external = typed(DIALECTS[0][1]);
    const managed = new CompilerProbeDriver(DIALECTS[0][1]);
    await managed.getKnex().schema.dropTableIfExists(MULTI_OBJECT);
    await managed.initObjects([{ name: MULTI_OBJECT, fields: MULTI_FIELDS } as never]);
    try {
      for (const field of ['picks', 'refs', 'tags_', 'scalar_flag', 'retired_flags']) {
        const filter = { [field]: { $contains: 'a' } } as FilterCondition;
        expect(managed.compileWhere(filter), field).toBe(external.compileWhere(filter));
      }
      // …and the agreed construct is the working one, not an agreed `1 = 0`.
      expect(managed.compileWhere({ picks: { $contains: 'a' } })).toMatch(REAL_PREDICATE.sqlite!);
    } finally {
      await managed.getKnex().schema.dropTableIfExists(MULTI_OBJECT).catch(() => {});
      await managed.disconnect?.();
    }
  });

  /**
   * ONE GUARD FOR THE WHOLE CLASS — the invariant behind all three limbs of the
   * predicate rather than the two types this card named.
   *
   * A JSON column's `$contains` is the MEMBERSHIP spelling #7398 deliberately
   * preserved, never a substring test over a stored scalar, which is the only
   * thing the declared-type gate is about. So the gate must not fire on ANY
   * JSON column.
   *
   * ⭐ [#17469] The sweep runs in BOTH directions now, and the second direction
   * is the ruling: a declared non-text class carrying `multiple: true` is NOT
   * multi-valued, so it is an ordinary scalar column and the gate DOES fire on
   * it. Before the ruling this row asserted the opposite, over a declaration
   * `FieldSchema` now refuses.
   */
  it('the gate never fires on a JSON column — and DOES fire on a retired `multiple` non-text class', () => {
    const classes = RETIRED_MULTI_TYPES;
    expect(classes.length, 'the swept population — a class added upstream must reach this sweep').toBeGreaterThan(8);
    for (const declared of classes) {
      const d = new CompilerProbeDriver(DIALECTS[0][1]).declareMulti({
        many: { type: declared, multiple: true },
        one: { type: declared },
      });
      // The ruled storage change: `multiple` on this class declares nothing, so
      // both columns are scalars of the same declared class and both are gated.
      expect(d.compileWhere({ many: { $contains: 'x' } }), `multiple:true ${declared}`).toMatch(/1 = 0/);
      expect(d.compileWhere({ one: { $contains: 'x' } }), `scalar ${declared}`).toMatch(/1 = 0/);
    }
    // …while a JSON column of every shape that still produces one is NOT gated,
    // which is what keeps the rows above from reading as a dead gate.
    const json = new CompilerProbeDriver(DIALECTS[0][1]).declareMulti({
      sel: { type: 'select', multiple: true },
      look: { type: 'lookup', multiple: true },
      usr: { type: 'user', multiple: true },
      checks: { type: 'checkboxes' },
      blob: { type: 'json' },
    });
    for (const field of ['sel', 'look', 'usr', 'checks', 'blob']) {
      expect(json.compileWhere({ [field]: { $contains: 'x' } } as FilterCondition), field).not.toMatch(/1 = 0/);
    }
  });
});
