// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter logical-combinator conformance for `translateFilter` — the MongoDB
 * query documents it EMITS, asserted without a server (#4405).
 *
 * `mongodb-filter.ts` is an independent FilterCondition backend: the fifth one,
 * and the one #3774 never enrolled when it named "the four". Its `$and` / `$or`
 * / `$not` translation shares no line of code with the SQL compiler or the
 * in-memory matcher, so nothing held it to the shared standard in
 * `@objectstack/spec/data` — the standard that exists because a backend can
 * widen a filter and still look like it is filtering (#3774 compiled
 * `{$or:[{a,b}]}` to `a = ? OR b = ?`, and every read-visibility filter written
 * that way returned rows the scope excluded).
 *
 * This is the half that must ALWAYS run. `translateFilter` is a pure function,
 * and a driver defect only a downloadable 123 MB binary can catch is a defect
 * nobody catches on a restricted network — the reason `test-mongod.ts` exists
 * and the reason the #4419 suites split the same way. `mongodb-filter-logic-
 * conformance.test.ts` runs the same shared cases against a real mongod and
 * answers the question this file cannot: does MongoDB agree?
 *
 * ## Why there is a matcher in here at all
 *
 * A translator's output is a document, and the shared cases are stated in row
 * ids, so something has to bridge the two. Pinning the emitted document
 * literally for all eighteen cases would pin today's spelling rather than the
 * semantics — the standard is "these ids, and no others", not "this JSON".
 *
 * So {@link matchDoc} evaluates the emitted document over
 * {@link FILTER_LOGIC_ROWS} by MongoDB's documented semantics, and is
 * deliberately **strict**: every shape it does not model is a thrown error, not
 * a silently-true predicate. A stand-in more permissive than the real engine
 * turns a suite into a green light for broken code, which is the hazard #4419
 * called out. Its own discrimination is proved below (a widened document must
 * FAIL the case it widens), so "all green" cannot mean "the matcher says yes to
 * everything".
 *
 * The named risk areas from #4405 get literal wire-shape pins on top of the
 * sweep, because they are where the two engines' vocabularies differ rather
 * than where a row count differs: MongoDB has no document-level `$not` at all
 * (the server answers `unknown top level operator: $not`), so a negation has to
 * leave here as `$nor` or as a per-field `$not`, and a nested `$and` inside a
 * `$or` branch must stay a nested document rather than being flattened into its
 * parent.
 */

import { describe, it, expect } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS, type FilterLogicRow } from '@objectstack/spec/data';
import { translateFilter } from './mongodb-filter.js';

// ── A deliberately strict reader of the emitted document ────────────────────

/** Thrown for any shape this matcher does not model — never swallowed. */
class UnsupportedShape extends Error {}

/**
 * MongoDB orders values only WITHIN a BSON type bracket; across brackets a
 * range predicate simply does not match. The shared fixture is all strings, so
 * a cross-type comparison here means the translator produced a comparand the
 * case never asked for.
 */
function compare(a: unknown, b: unknown): number | undefined {
  if (typeof a !== typeof b) return undefined; // different bracket → no order
  if (typeof a === 'string' || typeof a === 'number') {
    return a === b ? 0 : (a as any) < (b as any) ? -1 : 1;
  }
  throw new UnsupportedShape(`unsupported comparand type: ${typeof a}`);
}

/** Operators applied to one field's value. */
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
      case '$exists':
        if ((value !== undefined) !== arg) return false;
        break;
      case '$regex': {
        // [#13540] Written by the translator for `$contains`/`$notContains`
        // (an escaped literal pattern), so the conformance sweep produces it
        // the moment those operators have enrolled rows. MongoDB applies
        // `$regex` to STRING values only: a null, missing or non-string value
        // never matches — which is exactly what makes the emitted
        // `{ $not: { $regex } }` satisfy a no-value row.
        if (typeof arg !== 'string') throw new UnsupportedShape('$regex with a non-string pattern');
        if (typeof value !== 'string' || !new RegExp(arg).test(value)) return false;
        break;
      }
      case '$not': {
        // The per-field negation — the only `$not` MongoDB accepts, and it
        // takes an operator document, never a plain value.
        if (!arg || typeof arg !== 'object' || Array.isArray(arg)) {
          throw new UnsupportedShape('per-field $not takes an operator document');
        }
        if (matchOps(value, arg as Record<string, unknown>)) return false;
        break;
      }
      default:
        throw new UnsupportedShape(`unsupported field operator '${op}'`);
    }
  }
  return true;
}

/** One field key of a query document: a literal, or an operator document. */
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

/**
 * Evaluate an emitted MongoDB query document against one fixture row.
 *
 * Models exactly what MongoDB does for the vocabulary these cases can produce,
 * and throws for everything else — including a document-level `$not`, which the
 * server itself rejects.
 */
export function matchDoc(row: FilterLogicRow, doc: Record<string, unknown>): boolean {
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
      case '$nor':
        if (!Array.isArray(value)) throw new UnsupportedShape('$nor without an array');
        if (value.some((sub) => matchDoc(row, sub as Record<string, unknown>))) return false;
        break;
      case '$not':
        throw new UnsupportedShape(
          'document-level $not — MongoDB has no such operator and answers '
            + '`unknown top level operator: $not`; a negation must be emitted as $nor '
            + 'or as a per-field $not',
        );
      default:
        if (key.startsWith('$')) throw new UnsupportedShape(`unsupported document operator '${key}'`);
        if (!matchField((row as any)[key], value)) return false;
    }
  }
  return true;
}

/** Ids the emitted document selects from the shared fixture, ascending. */
function select(doc: Record<string, unknown>): string[] {
  return FILTER_LOGIC_ROWS.filter((row) => matchDoc(row, doc))
    .map((row) => row.id)
    .sort((x, y) => x.localeCompare(y));
}

/** Walk an emitted document, reporting every document-level `$not`. */
function documentLevelNots(doc: unknown, path = '$'): string[] {
  if (Array.isArray(doc)) return doc.flatMap((d, i) => documentLevelNots(d, `${path}[${i}]`));
  if (!doc || typeof doc !== 'object') return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (key === '$not') found.push(path);
    // Only logical operators carry further query DOCUMENTS; anything under a
    // field key is an operator document, where `$not` is legal.
    if (key === '$and' || key === '$or' || key === '$nor') {
      found.push(...documentLevelNots(value, `${path}.${key}`));
    }
  }
  return found;
}

// ── The shared standard ─────────────────────────────────────────────────────

describe('translateFilter — filter logic conformance, without a server (#4405)', () => {
  for (const c of FILTER_LOGIC_CASES) {
    it(c.name, () => {
      const doc = translateFilter(c.filter) as Record<string, unknown>;
      expect(select(doc), `${c.note ?? ''}\nemitted: ${JSON.stringify(doc)}`).toEqual([
        ...c.expected,
      ]);
    });
  }
});

// ── The vocabulary gap the row counts cannot show ───────────────────────────

describe('translateFilter — the shapes MongoDB spells differently', () => {
  it('never emits a document-level $not: the server rejects it outright', () => {
    for (const c of FILTER_LOGIC_CASES) {
      const doc = translateFilter(c.filter) as Record<string, unknown>;
      expect(documentLevelNots(doc), `${c.name} emitted ${JSON.stringify(doc)}`).toEqual([]);
    }
  });

  it('$not becomes a $nor that AND-s with the sibling keys of its own branch', () => {
    // The #4405 risk area, stated literally: the negation is a `$nor`, and it
    // joins `b: 'zz'` with `$and` rather than replacing it.
    expect(translateFilter({ $or: [{ c: 'nope' }, { $not: { a: 'x' }, b: 'zz' }] })).toEqual({
      $or: [{ c: 'nope' }, { $and: [{ b: 'zz' }, { $nor: [{ a: 'x' }] }] }],
    });
  });

  it('a nested $and inside a $or branch stays nested, and keeps the branch key beside it', () => {
    expect(translateFilter({ $or: [{ c: 'nope' }, { $and: [{ a: 'qq' }], b: 'y' }] })).toEqual({
      $or: [{ c: 'nope' }, { $and: [{ b: 'y' }, { $and: [{ a: 'qq' }] }] }],
    });
  });

  it('a multi-key $or branch stays ONE document — the shape #3774 flattened', () => {
    expect(translateFilter({ $or: [{ a: 'x', b: 'y' }] })).toEqual({
      $or: [{ a: 'x', b: 'y' }],
    });
  });
});

// ── The matcher is not the thing being tested, so it gets tested ────────────

describe('the in-process matcher discriminates', () => {
  it('a widened document FAILS the case it widens (the #3774 miscompile)', () => {
    // `{$or:[{a:'x',b:'y'}]}` must select row 1 alone. This is what OR-ing the
    // branch's own keys would have emitted instead — if the sweep above can
    // pass with this, it is proving nothing.
    expect(select({ $or: [{ a: 'x' }, { b: 'y' }] })).toEqual(['1', '2', '3']);
    expect(select({ $or: [{ a: 'x', b: 'y' }] })).toEqual(['1']);
  });

  it('a widened operator window FAILS too', () => {
    expect(select({ b: { $gte: 'y', $lt: 'z' } })).toEqual(['1', '3']);
    expect(select({ $or: [{ b: { $gte: 'y' } }, { b: { $lt: 'z' } }] })).toEqual(['1', '2', '3', '4']);
  });

  it('refuses a document-level $not instead of quietly evaluating one', () => {
    expect(() => matchDoc(FILTER_LOGIC_ROWS[0], { $not: { a: 'x' } })).toThrow(
      /document-level \$not/,
    );
  });

  it('refuses any operator it does not model, rather than treating it as true', () => {
    expect(() => matchDoc(FILTER_LOGIC_ROWS[0], { a: { $mod: [2, 0] } })).toThrow(/unsupported/);
    expect(() => matchDoc(FILTER_LOGIC_ROWS[0], { $expr: {} })).toThrow(/unsupported/);
  });

  it('models $regex the way the server applies it: strings only, so a negated pattern satisfies a no-value row', () => {
    // [#13540] `$regex` joined the modelled vocabulary when the
    // `$notContains` row enrolled (the translator emits `{ $not: { $regex } }`
    // for it). Pin both halves of the string-only rule: the positive form
    // never matches the null rows, and the negated form always does.
    expect(select({ d: { $regex: 'v' } })).toEqual(['1', '2']);
    expect(select({ d: { $not: { $regex: 'v1' } } })).toEqual(['2', '3', '4']);
  });

  it('honours $nor and the per-field $not the translator is allowed to emit', () => {
    expect(select({ $nor: [{ a: 'x' }] })).toEqual(['3', '4']);
    expect(select({ a: { $not: { $eq: 'x' } } })).toEqual(['3', '4']);
  });
});
