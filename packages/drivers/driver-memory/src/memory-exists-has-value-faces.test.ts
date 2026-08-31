// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13195] `$exists` = HAS A VALUE, and the four exits of this package that do
 * not all say so — measured, not read.
 *
 * ## The ruling
 *
 * `$exists` means "the field has a value" (`!= null`), never key-presence:
 * #5298 leg 3 / #5369, landed in PR #5962. It is settled and shipped on the
 * surfaces that ruling named — `@objectstack/formula`'s `matchesFilterCondition`
 * and this package's reference matcher (`memory-matcher.ts`, pinned by
 * `memory-matcher-not-null-safe.test.ts`).
 *
 * ## What this file is — and what it WAS
 *
 * It began as a PIN OF THE MEASURED PRESENT, taken because the card recorded
 * this divergence as reading rather than execution and its own header said so
 * ("Read, not re-measured"). Executing it found the reading OPTIMISTIC by a
 * factor of three, exactly as `aggregation-conformance.ts`'s DEBT note predicts
 * a read row will be: one recorded column on two surfaces became three
 * divergent cells across four exits.
 *
 * ⚖️ RULED 2026-08-30. The maintainer adopted option A — all three lagging
 * exits align to the settled semantic, `$exists` = HAS A VALUE. `driver-mongodb`
 * needed no invention: the same translator already emits `{$ne: null}` /
 * `{$eq: null}` for `$null`, and a real mongod 8.2.6 was measured compliant on
 * both readings. So this file is no longer a pin of a divergence; it is the
 * ENFORCEMENT of the ruling, INVERTED IN PLACE per its own former instruction.
 * Nothing was deleted and nothing was re-baselined onto whatever the new code
 * happened to print: every expectation below was already carrying the ruling's
 * answer beside the measured one, and the flip is that named answer.
 *
 * ⛔ Still NOT done here, and deliberately: the `FILTER_LOGIC_CASES` enrolment
 * that would score this cell on the conformance gate. The DEBT ledger in
 * `scripts/check-driver-conformance.mjs` is per (driver x case-set), so a row
 * cannot be added one driver at a time; and `packages/spec` was fenced for the
 * dispatch that landed this. The backends have now moved, which is the
 * precondition the card's step 4 names — the enrolment is the next card, not a
 * rider on this one.
 *
 * ## Why the fixture has TWO readings and why that is the load-bearing part
 *
 * "No value" has two shapes, and they reach different code:
 *
 *   - `name: null`   — how a SQL NULL round-trips into a record;
 *   - the key ABSENT — what a partial write leaves.
 *
 * Measured: EVERY divergent cell in this file was on the `name: null` reading,
 * and the key-absent reading agreed with the ruling on all four exits already.
 * That is the opposite shape from the neighbouring #13166 cell, where
 * `$notContains` diverged on both readings and `$nin` on the absent one only.
 * Consequence worth stating loudly, and the reason both columns survive the
 * flip: a fixture that spells "no value" as an ABSENT KEY measured ZERO of this
 * divergence, and now measures ZERO of the repair. The key-absent column is
 * kept as the CONTROL that the alignment moved only what it was meant to —
 * `{$ne: null}` answers has-value on both readings, so those rows must be
 * exactly as they were before.
 *
 * ## Why `$exists: false` is here and not only `$exists: true`
 *
 * The recorded table carried one column, `$exists: true` on a null value, whose
 * divergence was SURPLUS — a row the author can see and narrow. `$exists: false`
 * diverged in the opposite direction, and it was the worse one: the row with no
 * value was DROPPED from the query that asks for rows with no value, so the
 * caller saw an empty result and had nothing to narrow.
 * `filter-logic-conformance.ts` makes exactly that trade its reason for keeping
 * the include direction on `$ne` / `$nin` ("silent absence for visible
 * surplus"); this cell sat on the wrong side of it and was invisible while only
 * `$exists: true` was recorded. It is the harm the ruling's record calls the
 * hardest live one, and closing it is why `$exists: false` and
 * `$not {$exists: true}` are both asserted below rather than one standing in
 * for the other.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

/** `name` present but NULL — how a SQL NULL round-trips into a record. */
const NULLED: Array<Record<string, unknown>> = [
  { id: '1', name: 'alpha-one' },
  { id: '2', name: 'beta' },
  { id: '3', name: null },
];

/** The same rows with `name` ABSENT — the shape a partial write leaves. */
const MISSING: Array<Record<string, unknown>> = [
  { id: '1', name: 'alpha-one' },
  { id: '2', name: 'beta' },
  { id: '3' },
];

const sorted = (ids: string[]): string[] => [...ids].sort();

/** Exit 1 — the LIVE query path: `find()` → `convertToMongoQuery` → mingo. */
async function liveIds(rows: Array<Record<string, unknown>>, where: unknown): Promise<string[]> {
  const driver = new InMemoryDriver({ persistence: false });
  await driver.connect();
  for (const row of rows) await driver.create('t', { ...row });
  try {
    const out = await driver.find('t', { where } as never);
    return sorted((out as Array<Record<string, unknown>>).map((r) => String(r.id)));
  } finally {
    await driver.disconnect();
  }
}

/** Exit 2 — the REFERENCE matcher, the exit #5962 already aligned. */
const matcherIds = (rows: Array<Record<string, unknown>>, where: unknown): string[] =>
  sorted(rows.filter((r) => match(r, where)).map((r) => String(r.id)));

const CUBE = {
  name: 'deals',
  title: 'Deals',
  sql: 't',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: 'id' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    name: { name: 'name', label: 'Name', type: 'string', sql: 'name' },
  },
  public: true,
} as never;

/** Exits 3 and 4 — the analytics face's EXECUTED rows and its ECHOED statement. */
async function analytics(
  rows: Array<Record<string, unknown>>,
  where: unknown,
): Promise<{ executed: string[]; sql: string }> {
  const driver = new InMemoryDriver({ persistence: false });
  await driver.connect();
  for (const row of rows) await driver.create('t', { ...row });
  const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] } as never);
  const query = { cube: 'deals', measures: ['total'], dimensions: ['id'], where } as never;
  try {
    const executed = sorted(
      ((await service.query(query)).rows as Array<Record<string, unknown>>).map((r) => String(r.id)),
    );
    const { sql } = await service.generateSql(query);
    return { executed, sql: sql.replace(/\s+/g, ' ') };
  } finally {
    await driver.disconnect();
  }
}

describe('[#13195] `$exists` on a row with NO VALUE — the two readings, the four exits', () => {
  describe('the key-absent reading: the CONTROL — it answered the ruling before and must not move', () => {
    it('`$exists: true` excludes the no-key row everywhere', async () => {
      expect(await liveIds(MISSING, { name: { $exists: true } })).toEqual(['1', '2']);
      expect(matcherIds(MISSING, { name: { $exists: true } })).toEqual(['1', '2']);
      expect((await analytics(MISSING, { name: { $exists: true } })).executed).toEqual(['1', '2']);
    });

    it('`$exists: false` returns the no-key row everywhere', async () => {
      expect(await liveIds(MISSING, { name: { $exists: false } })).toEqual(['3']);
      expect(matcherIds(MISSING, { name: { $exists: false } })).toEqual(['3']);
      expect((await analytics(MISSING, { name: { $exists: false } })).executed).toEqual(['3']);
    });

    it('`$not` around it agrees too, on the exits that accept `$not`', async () => {
      expect(await liveIds(MISSING, { $not: { name: { $exists: true } } })).toEqual(['3']);
      expect(matcherIds(MISSING, { $not: { name: { $exists: true } } })).toEqual(['3']);
    });
  });

  describe('the `name: null` reading: every exit now answers the ruling (#13195, ruled 2026-08-30)', () => {
    it('the reference matcher reads HAS-VALUE — the ruling, shipped by #5962', () => {
      expect(matcherIds(NULLED, { name: { $exists: true } })).toEqual(['1', '2']);
      expect(matcherIds(NULLED, { name: { $exists: false } })).toEqual(['3']);
      expect(matcherIds(NULLED, { $not: { name: { $exists: true } } })).toEqual(['3']);
    });

    it('the live mingo path reads HAS-VALUE: `$exists: true` drops the null row', async () => {
      // Was ['1','2','3'] — the operator went to mingo under its own name and
      // mingo tests KEY PRESENCE. It now lowers to `{$ne: null}`, the spelling
      // `$null` in the same method already used. The ruling's answer, named in
      // this line's own comment before the flip existed.
      expect(await liveIds(NULLED, { name: { $exists: true } })).toEqual(['1', '2']);
    });

    it('THE HARDEST LIVE HARM, CLOSED — `$exists: false` returns the no-value row', async () => {
      // Was [] on BOTH spellings: the row with no value was dropped from the
      // query that asks for rows with no value, so the caller got silent
      // absence and nothing to narrow. The ruling's record names this the
      // hardest live harm — a caller wanting no-value rows got an empty result
      // on three of the four exits.
      expect(await liveIds(NULLED, { name: { $exists: false } })).toEqual(['3']);
      expect(await liveIds(NULLED, { $not: { name: { $exists: true } } })).toEqual(['3']);
    });

    it('`$exists: false` and `$not {$exists: true}` AGREE — asserted as an equality', async () => {
      // The two spellings diverged from the ruling together, and the record
      // requires that they now agree with EACH OTHER as well as with the
      // ruling. Asserted directly so a future change that moves only one of
      // them cannot pass by moving both expectations independently.
      const direct = await liveIds(NULLED, { name: { $exists: false } });
      const negated = await liveIds(NULLED, { $not: { name: { $exists: true } } });
      expect(direct).toEqual(negated);
      expect(direct).toEqual(matcherIds(NULLED, { name: { $exists: false } }));

      // And on the other reading of "no value", where they already agreed.
      const directMissing = await liveIds(MISSING, { name: { $exists: false } });
      const negatedMissing = await liveIds(MISSING, { $not: { name: { $exists: true } } });
      expect(directMissing).toEqual(negatedMissing);
      expect(directMissing).toEqual(['3']);
    });

    it('the analytics face EXECUTES the has-value answer', async () => {
      // Was ['1','2','3'] and [] — this face built its own `{$exists: <bool>}`
      // and handed it to mingo, so it inherited key-presence independently of
      // the live path above.
      expect((await analytics(NULLED, { name: { $exists: true } })).executed).toEqual(['1', '2']);
      expect((await analytics(NULLED, { name: { $exists: false } })).executed).toEqual(['3']);
    });

    it('the analytics face no longer disagrees with ITSELF — echo and rows now match', async () => {
      // The statement drawn beside the chart says `IS NOT NULL` / `IS NULL`,
      // which was already the ruling; the rows the chart was drawn FROM said
      // key-presence. This assertion was an INEQUALITY, kept so the split could
      // not be closed in silence. It was not closed in silence — it is an
      // EQUALITY now, and the echo half is unchanged.
      const t = await analytics(NULLED, { name: { $exists: true } });
      const f = await analytics(NULLED, { name: { $exists: false } });
      expect(t.sql).toContain('name IS NOT NULL');
      expect(f.sql).toContain('name IS NULL');
      expect(t.executed).toEqual(matcherIds(NULLED, { name: { $exists: true } }));
      expect(f.executed).toEqual(matcherIds(NULLED, { name: { $exists: false } }));
    });
  });

  describe('controls — the fixture really carries the two readings, and the exits still discriminate', () => {
    it('the driver stores a null VALUE for one fixture and NO KEY for the other', async () => {
      const store = async (rows: Array<Record<string, unknown>>) => {
        const driver = new InMemoryDriver({ persistence: false });
        await driver.connect();
        for (const row of rows) await driver.create('t', { ...row });
        try {
          const all = (await driver.find('t', {} as never)) as Array<Record<string, unknown>>;
          const three = all.find((r) => r.id === '3')!;
          return { hasKey: Object.prototype.hasOwnProperty.call(three, 'name'), value: three.name };
        } finally {
          await driver.disconnect();
        }
      };
      expect(await store(NULLED)).toEqual({ hasKey: true, value: null });
      expect(await store(MISSING)).toEqual({ hasKey: false, value: undefined });
    });

    it('a predicate that should narrow still narrows on every exit', async () => {
      expect(await liveIds(NULLED, { name: { $eq: 'beta' } })).toEqual(['2']);
      expect(matcherIds(NULLED, { name: { $eq: 'beta' } })).toEqual(['2']);
      expect((await analytics(NULLED, { name: { $eq: 'beta' } })).executed).toEqual(['2']);
    });
  });

  /**
   * [#13195] `$exists` SHARING a field constraint with another operator.
   *
   * Not in the recorded table, not in the card, and not a cell the ruling
   * names — it is a consequence of the lowering the ruling prescribes, found by
   * measuring it. `{$ne: null}` / `{$eq: null}` reuse mingo keys an AUTHOR can
   * write on the same field, so a naive merge assigns `$ne` twice into one
   * object and one of the two constraints silently disappears — and WHICH one
   * depends on the author's key order.
   *
   * Measured with the lowering in place and the promotion guard removed, on the
   * NULLED fixture: `{$exists: true, $ne: 'beta'}` answered `['1','3']`,
   * the key-swapped `{$ne: 'beta', $exists: true}` answered `['1','2']`, and
   * `{$exists: false, $eq: 'alpha-one'}` answered `['1']` — a row that HAS a
   * value returned by a filter demanding it have none. The reference matcher,
   * which loops the operators and cannot clobber, said `['1']`, `['1']` and
   * `[]`.
   *
   * Four of those six cells AGREED with the reference matcher on `origin/main`
   * before the alignment, so shipping the merge unguarded would have traded a
   * fixed single-operator cell for a broken composed one — the one-driver,
   * two-faces shape this card exists to remove. The reference matcher is the
   * ORACLE here, exactly as it is for the single-operator cells above.
   */
  describe('composed constraints — the lowering must not clobber a sibling operator', () => {
    const COMPOSED: Array<[string, unknown]> = [
      ['$exists:true beside $ne', { name: { $exists: true, $ne: 'beta' } }],
      ['$ne beside $exists:true (keys swapped)', { name: { $ne: 'beta', $exists: true } }],
      ['$exists:false beside $eq', { name: { $exists: false, $eq: 'alpha-one' } }],
      ['$exists:true beside $eq', { name: { $exists: true, $eq: 'alpha-one' } }],
      ['$exists:true beside $contains', { name: { $exists: true, $contains: 'alpha' } }],
    ];

    for (const [label, where] of COMPOSED) {
      it(`${label}: the live path answers what the reference matcher answers`, async () => {
        for (const rows of [NULLED, MISSING]) {
          expect(await liveIds(rows, where), label).toEqual(matcherIds(rows, where));
        }
      });
    }

    it('the two key orders of one predicate answer identically', async () => {
      for (const rows of [NULLED, MISSING]) {
        expect(await liveIds(rows, { name: { $exists: true, $ne: 'beta' } })).toEqual(
          await liveIds(rows, { name: { $ne: 'beta', $exists: true } }),
        );
      }
    });

    it('CONTROL — the composed predicate really is narrower than either half', async () => {
      // Without this the block above could pass on a fixture where the two
      // constraints happen to select the same rows, certifying nothing.
      expect(await liveIds(NULLED, { name: { $exists: true, $ne: 'beta' } })).toEqual(['1']);
      expect(await liveIds(NULLED, { name: { $exists: true } })).toEqual(['1', '2']);
      expect(await liveIds(NULLED, { name: { $ne: 'beta' } })).toEqual(['1', '3']);
    });
  });
});
