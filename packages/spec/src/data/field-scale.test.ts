// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolveFieldScale } from './field-scale';
import { NUMERIC_VALUE_TYPES } from './field-value.zod';
import { FieldSchema } from './field.zod';

/**
 * The absent-`scale` declaration (maintainer ruling, letter A′: the protocol
 * declares the default decimal places for an ABSENT `scale` per field type and
 * consumers read it from the protocol — no `?? N` in any consumer; percent ⇒ 0).
 *
 * Three things are pinned, and the third is the one that is easy to lose:
 *
 * 1. the declared value, and that a DECLARATION still wins over it;
 * 2. that every other numeric type answers `undefined` — a real answer, not a
 *    hole, held in both directions against the numeric family;
 * 3. that the declaration is NOT a parse-time materialization. `packages/objectql`'s
 *    record validator gates its write-time `max_scale` refusal on
 *    `def.scale !== undefined`, so a materialized `0` would arm that refusal on
 *    every percent field whose author declared nothing. The assertion lives on
 *    the spec side of that seam (parse output carries no `scale`) because
 *    `packages/spec` may not depend on a consumer package.
 */
describe('resolveFieldScale', () => {
  it('resolves an absent scale on a percent field to 0 — the ruled value', () => {
    expect(resolveFieldScale({ type: 'percent' })).toBe(0);
  });

  it('prefers a DECLARED scale over the type default', () => {
    expect(resolveFieldScale({ type: 'percent', scale: 2 })).toBe(2);
    expect(resolveFieldScale({ type: 'number', scale: 3 })).toBe(3);
    expect(resolveFieldScale({ type: 'currency', scale: 4 })).toBe(4);
  });

  it('treats a declared 0 as a declaration, not as absence', () => {
    // The distinction is load-bearing on `number`: a DECLARED 0 marks a
    // discrete integer and is rendered ungrouped, while an absent scale keeps
    // its separators. Both must reach a consumer as themselves.
    expect(resolveFieldScale({ type: 'number', scale: 0 })).toBe(0);
    expect(resolveFieldScale({ type: 'percent', scale: 0 })).toBe(0);
  });

  it('declares NO width for number and currency — the census came back inconsistent', () => {
    // ⛔ Not a hole to fill with a fallback: `number`'s faces disagree by
    // design (no-fixed-width on the cell, 0 in the summary footer) and the
    // grouping policy keys on absent-vs-declared-0; `currency` resolves its
    // fraction digits from ISO 4217 minor units with a different surface's
    // `precision` as the override, and does not read this key at all.
    expect(resolveFieldScale({ type: 'number' })).toBeUndefined();
    expect(resolveFieldScale({ type: 'currency' })).toBeUndefined();
  });

  it('answers undefined for a missing, empty or non-numeric-typed field', () => {
    expect(resolveFieldScale(undefined)).toBeUndefined();
    expect(resolveFieldScale({})).toBeUndefined();
    expect(resolveFieldScale({ type: 'text' })).toBeUndefined();
  });

  it('refuses a malformed declaration through the same door the write path uses', () => {
    // `Number.isInteger(scale) && scale >= 0` — a digit count of 2.5 or -1 has
    // no defined meaning, and inventing floor/round semantics here would be
    // the consumer-side guessing the platform refuses. A `scale` arriving as a
    // STRING out of stored JSON is refused for the same reason rather than
    // coerced. Each falls back to the type's declared absent value.
    expect(resolveFieldScale({ type: 'percent', scale: 2.5 })).toBe(0);
    expect(resolveFieldScale({ type: 'percent', scale: -1 })).toBe(0);
    expect(resolveFieldScale({ type: 'percent', scale: '2' })).toBe(0);
    expect(resolveFieldScale({ type: 'percent', scale: Number.NaN })).toBe(0);
    expect(resolveFieldScale({ type: 'number', scale: 2.5 })).toBeUndefined();
  });

  it('returns a declared width past the renderable ceiling verbatim — no clamp here', () => {
    // The ceiling is refused at the AUTHORING seam by `FieldSchema.scale`; a
    // stored over-ceiling width is clamped by the one consumer that rules on
    // it, under its own sunset. This resolver adds no second policy.
    expect(resolveFieldScale({ type: 'percent', scale: 101 })).toBe(101);
  });

  it('holds the per-type table equal to the numeric family in BOTH directions', () => {
    // A numeric type joining the family with no row answers `undefined`, which
    // is legal — but it must be a DECISION, so the roster is spelled out here
    // and a new member reds this test until it is judged.
    const answers = new Map<string, number | undefined>(
      [...NUMERIC_VALUE_TYPES].sort().map((t) => [t, resolveFieldScale({ type: t })]),
    );
    expect(Object.fromEntries(answers)).toEqual({
      currency: undefined,
      number: undefined,
      percent: 0,
      progress: undefined,
      rating: undefined,
      slider: undefined,
      summary: undefined,
    });
    // And nothing outside the numeric family carries a row: the table is read
    // by type, so a stray row would answer on a face that never displays a
    // decimal width.
    for (const t of ['text', 'boolean', 'date', 'datetime', 'select', 'lookup', 'file']) {
      expect(resolveFieldScale({ type: t })).toBeUndefined();
    }
  });
});

describe('the absent scale is NOT materialized at parse time', () => {
  it('parses a bare percent field to output carrying no `scale` key', () => {
    // ⭐ The load-bearing pin. `packages/objectql`'s record validator arms its
    // write-time `max_scale` REFUSAL only when `def.scale !== undefined`, so a
    // materialized `0` here would start rejecting writes the platform accepts
    // today — a stored-data change bought for a display ruling. The absent
    // value stays absent on the parsed field and is resolved at display.
    const parsed = FieldSchema.parse({ name: 'win_rate', label: 'Win rate', type: 'percent' });
    expect('scale' in parsed).toBe(false);
    // The resolver still answers for it — that is the whole point of the split.
    expect(resolveFieldScale(parsed as { type?: string; scale?: unknown })).toBe(0);
  });

  it('round-trips an authored scale unchanged', () => {
    const parsed = FieldSchema.parse({ name: 'win_rate', label: 'Win rate', type: 'percent', scale: 2 });
    expect(parsed.scale).toBe(2);
  });
});

describe("FieldSchema.scale's describe states the absent value in the author's words", () => {
  const description = (FieldSchema.shape as Record<string, { description?: string }>).scale?.description ?? '';

  it('names the percent absent value and the resolver that answers it', () => {
    // The ③ facet of the ruling: the field reference page is generated from
    // this describe, and an author who reads only that page is exactly the
    // author the ruling is about. A pin, because a describe can be trimmed by
    // an unrelated edit and nothing else would notice.
    expect(description).toMatch(/OMITTED on a `percent` field/);
    expect(description).toContain('resolveFieldScale');
  });

  it('states that the other numeric types are NOT defaulted', () => {
    expect(description).toMatch(/NO fixed width/);
  });
});
