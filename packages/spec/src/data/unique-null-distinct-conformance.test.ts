// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29377] `UNIQUE_NULL_DISTINCT_CASES` lands ahead of every driver that runs
 * it — each driver's adoption is its own lane's PR — so between now and then
 * nothing executes the table, and a wrong `expected` would sit quietly until a
 * driver author trusted it. This file executes it, against a reference store
 * written from the declared rule: a row whose unique key has a NULL (`null` or
 * absent) in ANY key part is exempt; `''` is a value.
 *
 * The second job is proving the table is not VACUOUS: each way a driver can
 * get the rule wrong — the sparse index that indexes `null` (driver-mongodb
 * before #29339), folding `null` and absent onto one value, treating `''` as a
 * NULL, keying a compound on one column, enforcing nothing, refusing and
 * keeping the row — must fail at least one case.
 */

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from './object.zod';
import {
  UNIQUE_NULL_DISTINCT_CASES,
  UNIQUE_NULL_DISTINCT_OBJECTS,
  uniqueNullDistinctDivergence,
  type UniqueNullDistinctCase,
} from './unique-null-distinct-conformance';

// ── A reference store, from the declared rule ────────────────────────────────

type Row = Readonly<Record<string, unknown>>;

/** The ways a driver can get NULL-distinct `unique` wrong — `faithful` is the rule. */
type Reading =
  | 'faithful'
  | 'null-is-a-value' // a sparse index: an explicit null is indexed, only a missing field is skipped
  | 'null-and-absent-fold' // every NULL is one shared value
  | 'empty-string-is-null' // '' exempts the row like a NULL
  | 'first-part-only' // a compound key built over its first column alone
  | 'not-enforced' // the constraint is declared and never checked
  | 'refuses-and-keeps'; // the duplicate is refused, and landed anyway

/** The key parts of each object's one unique constraint. */
const KEY_PARTS: Readonly<Record<UniqueNullDistinctCase['object'], readonly string[]>> = {
  unique_null_single: ['code'],
  unique_null_compound: UNIQUE_NULL_DISTINCT_OBJECTS.unique_null_compound.indexes[0].fields,
};

const ABSENT = Symbol('absent');

/** One key part as `reading` sees it: `null` when it exempts the row, else the value it keys on. */
function part(row: Row, field: string, reading: Reading): unknown {
  if (!Object.prototype.hasOwnProperty.call(row, field) || row[field] === undefined) {
    return reading === 'null-and-absent-fold' ? ABSENT : null;
  }
  const value = row[field];
  if (value === null) return reading === 'null-is-a-value' || reading === 'null-and-absent-fold' ? ABSENT : null;
  if (value === '' && reading === 'empty-string-is-null') return null;
  return value;
}

/** The row's key under `reading`, or `null` when the row is exempt from the constraint. */
function keyOf(object: UniqueNullDistinctCase['object'], row: Row, reading: Reading): string | null {
  const fields = reading === 'first-part-only' ? KEY_PARTS[object].slice(0, 1) : KEY_PARTS[object];
  const parts = fields.map((f) => part(row, f, reading));
  if (parts.some((p) => p === null)) return null;
  return JSON.stringify(parts.map((p) => (p === ABSENT ? '<<NULL>>' : p)));
}

class UniqueRefusal extends Error {
  // The shape `driver-memory` throws, which `isUniqueViolationError` recognises.
  readonly code = 'UNIQUE_VIOLATION';
}

/** A store holding both objects, one unique constraint each, as `reading` enforces them. */
class ReferenceStore {
  private readonly rows = new Map<string, Row[]>();

  constructor(private readonly reading: Reading) {}

  create(object: UniqueNullDistinctCase['object'], row: Row): void {
    const table = this.rows.get(object) ?? [];
    this.rows.set(object, table);
    const key = keyOf(object, row, this.reading);
    const collides = key !== null && this.reading !== 'not-enforced'
      && table.some((other) => keyOf(object, other, this.reading) === key);
    if (collides && this.reading !== 'refuses-and-keeps') throw new UniqueRefusal('unique violation');
    table.push(row);
    if (collides) throw new UniqueRefusal('unique violation');
  }

  countLabelled(object: UniqueNullDistinctCase['object'], label: string): number {
    return (this.rows.get(object) ?? []).filter((r) => r.label === label).length;
  }
}

/**
 * Run the consumption recipe the case-set documents, on one store for every
 * case, in table order: first admitted, second admitted or refused, count by
 * label, judge. Returns the names of the cases that diverge.
 */
function divergent(reading: Reading, cases: readonly UniqueNullDistinctCase[] = UNIQUE_NULL_DISTINCT_CASES): string[] {
  const store = new ReferenceStore(reading);
  const out: string[] = [];
  for (const c of cases) {
    let firstAdmitted = true;
    try {
      store.create(c.object, c.first);
    } catch {
      firstAdmitted = false;
    }
    let second: 'admitted' | 'refused' = 'admitted';
    try {
      store.create(c.object, c.second);
    } catch (e) {
      // The recipe's judge: only a recognised unique refusal is a refusal.
      if (!(e instanceof UniqueRefusal)) throw e;
      second = 'refused';
    }
    const verdict = uniqueNullDistinctDivergence(c, second, store.countLabelled(c.object, c.name));
    if (!firstAdmitted || verdict !== null) out.push(c.name);
  }
  return out;
}

// ── The table, executed ──────────────────────────────────────────────────────

describe('UNIQUE_NULL_DISTINCT_CASES — the table agrees with the declared rule', () => {
  for (const c of UNIQUE_NULL_DISTINCT_CASES) {
    it(c.name, () => {
      expect(divergent('faithful', [c])).toEqual([]);
    });
  }

  it('every case on ONE store, in table order, still agrees: no case collides with another', () => {
    expect(divergent('faithful')).toEqual([]);
  });
});

describe('UNIQUE_NULL_DISTINCT_CASES — each wrong reading of the rule fails the table', () => {
  it('a sparse index (null indexed like a value) fails the two-nulls rows', () => {
    expect(divergent('null-is-a-value')).toEqual(
      expect.arrayContaining(['single_null_null', 'compound_one_null', 'compound_leading_null']),
    );
  });

  it('folding null and absent onto one value fails the absent rows too', () => {
    expect(divergent('null-and-absent-fold')).toEqual(
      expect.arrayContaining(['single_absent_absent', 'single_null_absent', 'compound_one_absent']),
    );
  });

  it("treating '' as a NULL fails exactly the empty-string row", () => {
    expect(divergent('empty-string-is-null')).toEqual(['single_empty_string']);
  });

  it('a compound key built over its first column alone fails', () => {
    expect(divergent('first-part-only')).toEqual(
      expect.arrayContaining(['compound_differs_in_one_part']),
    );
  });

  it('a constraint that is never checked fails every refused row', () => {
    expect(divergent('not-enforced')).toEqual(
      UNIQUE_NULL_DISTINCT_CASES.filter((c) => c.expected === 'refused').map((c) => c.name),
    );
  });

  it('a refusal that lands the row anyway fails every refused row, on the count', () => {
    expect(divergent('refuses-and-keeps')).toEqual(
      UNIQUE_NULL_DISTINCT_CASES.filter((c) => c.expected === 'refused').map((c) => c.name),
    );
  });
});

describe('uniqueNullDistinctDivergence — the shared judge', () => {
  const admitted = UNIQUE_NULL_DISTINCT_CASES.find((c) => c.expected === 'admitted') as UniqueNullDistinctCase;
  const refused = UNIQUE_NULL_DISTINCT_CASES.find((c) => c.expected === 'refused') as UniqueNullDistinctCase;

  it('answers null only on the expected answer AND the expected count', () => {
    expect(uniqueNullDistinctDivergence(admitted, 'admitted', 2)).toBeNull();
    expect(uniqueNullDistinctDivergence(refused, 'refused', 1)).toBeNull();
  });

  it('names the case, both rows and what was observed when it diverges', () => {
    const d = uniqueNullDistinctDivergence(admitted, 'refused', 1);
    expect(d).toContain(admitted.name);
    expect(d).toContain(JSON.stringify(admitted.second));
    expect(uniqueNullDistinctDivergence(admitted, 'admitted', 1)).not.toBeNull();
    expect(uniqueNullDistinctDivergence(refused, 'refused', 2)).not.toBeNull();
    expect(uniqueNullDistinctDivergence(refused, 'admitted', 2)).not.toBeNull();
  });
});

describe('UNIQUE_NULL_DISTINCT_CASES — the table is well-formed', () => {
  it('names are unique and each row is labelled with its case', () => {
    const names = UNIQUE_NULL_DISTINCT_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of UNIQUE_NULL_DISTINCT_CASES) {
      expect(c.first.label, c.name).toBe(c.name);
      expect(c.second.label, c.name).toBe(c.name);
    }
  });

  it('every non-NULL key value belongs to one case, so a suite may share one table', () => {
    const owner = new Map<string, string>();
    for (const c of UNIQUE_NULL_DISTINCT_CASES) {
      for (const row of [c.first, c.second]) {
        for (const f of KEY_PARTS[c.object]) {
          const v = row[f];
          if (v === null || v === undefined) continue;
          const k = `${c.object}.${f}=${JSON.stringify(v)}`;
          expect(owner.get(k) ?? c.name, k).toBe(c.name);
          owner.set(k, c.name);
        }
      }
    }
  });

  it('both answers are represented on both objects', () => {
    for (const object of Object.keys(UNIQUE_NULL_DISTINCT_OBJECTS)) {
      const answers = new Set(UNIQUE_NULL_DISTINCT_CASES.filter((c) => c.object === object).map((c) => c.expected));
      expect([...answers].sort(), object).toEqual(['admitted', 'refused']);
    }
  });

  it('the fixture objects are authorable: ObjectSchema accepts each, scope stated', () => {
    for (const o of Object.values(UNIQUE_NULL_DISTINCT_OBJECTS)) {
      const parsed = ObjectSchema.safeParse(o);
      expect(parsed.success, `${o.name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });
});
