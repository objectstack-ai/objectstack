// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7872] `driver-mongodb` held to `FILTER_COMPARAND_TYPE_CASES` — the
 * comparand-type door, both directions, answered without a server.
 *
 * ## Why the assertions run in-process rather than against mongod
 *
 * The same reason as `mongodb-filter-text-conformance.test.ts` (#6682): this
 * package's real-mongod suites are opt-in (#5517), so a standard that needed a
 * server would not run in CI. A `find()` performs exactly two judgeable steps
 * before the wire — `translateFilter`, then the `mongodb` package's own BSON
 * encoding — and #7956 measured this driver's divergence cells at precisely
 * those two steps. This suite makes the same BSON-serialize-level judgement,
 * stated here as the accepted substitute for a live server.
 *
 * ## The worst cell, and what "inherits via the shared path" means here
 *
 * This driver has NO comparand-type policy of its own, and the ruling keeps it
 * that way (#5499 freeze — nothing here patches the driver). Measured on the
 * wire: `{qty: undefined}` BSON-encodes to `{}` — a predicate the author wrote
 * to CONSTRAIN reaching the server as MATCH EVERYTHING, the one divergence
 * cell that returned MORE data rather than less. The door
 * (`parseFilterAST`, `@objectstack/spec/data`) refuses that input before
 * `translateFilter` runs; the reverse-direction pin below keeps the raw
 * silent-edit visible so the door's job cannot be mistaken for a mongo
 * behaviour change.
 */

import { describe, it, expect } from 'vitest';
import { BSON } from 'mongodb';
import {
  FILTER_COMPARAND_TYPE_CASES,
  FILTER_COMPARAND_TYPE_ROWS,
  parseFilterAST,
  type ComparandTypeRow,
  type FilterCondition,
} from '@objectstack/spec/data';
import { translateFilter } from './mongodb-filter.js';

// ── A deliberately strict reader of the emitted document ────────────────────
// Same discipline as `mongodb-filter-logic-translation.test.ts`'s `matchDoc`:
// every shape it does not model is a thrown error, never a silently-true
// predicate.

class UnsupportedShape extends Error {}

function compare(a: unknown, b: unknown): number | undefined {
  if (typeof a !== typeof b) return undefined; // different BSON bracket → no order
  if (typeof a === 'string' || typeof a === 'number') {
    return a === b ? 0 : (a as any) < (b as any) ? -1 : 1;
  }
  throw new UnsupportedShape(`unsupported comparand type: ${typeof a}`);
}

function matchOps(value: unknown, ops: Record<string, unknown>): boolean {
  for (const [op, arg] of Object.entries(ops)) {
    switch (op) {
      case '$eq':
        if (value !== arg) return false;
        break;
      case '$ne':
        if (value === arg) return false;
        break;
      case '$gt':
        if (!((compare(value, arg) ?? 0) > 0)) return false;
        break;
      case '$gte':
        if (!((compare(value, arg) ?? -1) >= 0)) return false;
        break;
      case '$lt':
        if (!((compare(value, arg) ?? 0) < 0)) return false;
        break;
      case '$lte':
        if (!((compare(value, arg) ?? 1) <= 0)) return false;
        break;
      case '$in':
        if (!Array.isArray(arg)) throw new UnsupportedShape('$in without an array');
        if (!arg.includes(value)) return false;
        break;
      case '$nin':
        if (!Array.isArray(arg)) throw new UnsupportedShape('$nin without an array');
        if (arg.includes(value)) return false;
        break;
      default:
        throw new UnsupportedShape(`unsupported field operator '${op}'`);
    }
  }
  return true;
}

function matchField(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
    const keys = Object.keys(cond as Record<string, unknown>);
    const ops = keys.filter((k) => k.startsWith('$'));
    if (ops.length === keys.length && keys.length > 0) {
      return matchOps(value, cond as Record<string, unknown>);
    }
    if (ops.length > 0) {
      throw new UnsupportedShape(`mixed operator/literal keys on one field: ${keys.join(', ')}`);
    }
  }
  return value === cond;
}

function matchDoc(row: ComparandTypeRow, doc: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(doc)) {
    switch (key) {
      case '$and':
        if (!Array.isArray(value)) throw new UnsupportedShape('$and without an array');
        if (!value.every((sub) => matchDoc(row, sub as Record<string, unknown>))) return false;
        break;
      case '$or':
        if (!Array.isArray(value)) throw new UnsupportedShape('$or without an array');
        if (!value.some((sub) => matchDoc(row, sub as Record<string, unknown>))) return false;
        break;
      default:
        if (key.startsWith('$')) throw new UnsupportedShape(`unsupported document operator '${key}'`);
        if (!matchField((row as any)[key], value)) return false;
    }
  }
  return true;
}

/**
 * The wire round trip, then the ids the document selects. Serializing FIRST is
 * the point: it is the step that silently edited `{qty: undefined}` to `{}` on
 * this driver, so a case evaluated without the round trip would judge a
 * document the server never sees.
 */
function selectAfterWire(doc: Record<string, unknown>): string[] {
  const wire = BSON.deserialize(BSON.serialize(doc)) as Record<string, unknown>;
  return FILTER_COMPARAND_TYPE_ROWS.filter((row) => matchDoc(row, wire))
    .map((row) => row.id)
    .sort((x, y) => x.localeCompare(y));
}

describe('[#7872] driver-mongodb — comparand-type conformance (server-free, behind the door)', () => {
  for (const c of FILTER_COMPARAND_TYPE_CASES) {
    if (c.verdict === 'door-refusal') {
      it(`${c.name} — refused at the door, before translateFilter runs`, () => {
        let caught: (Error & { code?: string; status?: number }) | null = null;
        try {
          parseFilterAST(c.filter());
        } catch (e) {
          caught = e as Error & { code?: string; status?: number };
        }
        expect(caught, c.note).not.toBeNull();
        expect(caught?.code, c.name).toBe(c.code);
        expect(caught?.status, c.name).toBe(400);
        for (const fragment of c.mustMention) expect(caught?.message).toContain(fragment);
      });
    } else if (c.verdict === 'matches') {
      it(c.name, () => {
        const validated = parseFilterAST(c.filter()) as FilterCondition;
        const doc = translateFilter(validated) as Record<string, unknown>;
        expect(selectAfterWire(doc), c.note).toEqual([...c.expected]);
      });
    } else {
      it(`${c.name} — translates and BSON-serializes without refusal`, () => {
        const validated = parseFilterAST(c.filter()) as FilterCondition;
        const doc = translateFilter(validated) as Record<string, unknown>;
        expect(() => BSON.serialize(doc)).not.toThrow();
      });
    }
  }

  /**
   * The reverse direction, pinned at the exact step #7956 measured it: WITHOUT
   * the door, the implicit-equality `undefined` still reaches the wire as `{}`
   * — match everything. This driver stays frozen (#5499), so the silent edit
   * is expected to persist on the direct path; the door is what stands in
   * front of it, and the refusal case above is the cell's platform answer. If
   * the mongodb package ever stops dropping undefined-valued keys, this pin
   * fails loudly and should be retired with its sentence in the suite header.
   */
  it('the silent-edit cell still exists on the direct path — {qty: undefined} wires to {}', () => {
    const doc = translateFilter({ qty: undefined } as unknown as FilterCondition) as Record<string, unknown>;
    const wire = BSON.deserialize(BSON.serialize(doc)) as Record<string, unknown>;
    expect(wire).toEqual({});
    // …which is precisely "match everything": both fixture rows.
    expect(FILTER_COMPARAND_TYPE_ROWS.filter((row) => matchDoc(row, wire)).map((r) => r.id))
      .toEqual(['1', '2']);
  });
});
