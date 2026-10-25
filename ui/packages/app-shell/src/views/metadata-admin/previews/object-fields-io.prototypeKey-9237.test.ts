// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { readFields, writeFields } from './object-fields-io.js';

/**
 * objectui#9237 — `writeFields` silently DELETED a stored field named
 * `__proto__` from the PUT body, and the spec ACCEPTED the result.
 *
 * ## Why this class is worse than the 422s the sibling suites pin
 *
 * `object-fields-io.spec-keys.test.ts` and
 * `object-fields-io.referenceCarryover-8896.test.ts` both guard REFUSAL
 * shapes: a key the server rejects, loudly, leaving the stored document
 * untouched and a reload as the escape. This one had no refusal anywhere in
 * it. The old `writeFields` body was
 *
 *   const out: Record OF string TO unknown = {};
 *   for (const e of view.entries) out[e.name] = e.def;
 *
 * and `out['__proto__'] = def` does not create a key — it invokes
 * `Object.prototype`'s setter — so the entry `readFields` had just read back
 * was gone before `JSON.stringify` ever saw it. The resulting document is
 * perfectly spec-legal, the PUT succeeds, the server stores the object WITHOUT
 * the field, and nothing anywhere reports a thing. There is no reload that
 * recovers it, because the field is gone from the store.
 *
 * The trigger is an edit that never touched the field: all 14 `writeFields`
 * call sites across the object designer re-serialize the whole map on every
 * save and reorder.
 *
 * ## ⭐ Why this pin must say `__proto__` and nothing else
 *
 * `__proto__` is the ONLY name that reproduces. It is the single accessor on
 * `Object.prototype`; every other member (`constructor`, `toString`,
 * `valueOf`, `hasOwnProperty`, `prototype`) is a data property, and assignment
 * shadows a data property with a normal own property. A pin written with one
 * of those names is green under the repair AND green under the defect — it
 * asserts nothing. `the name table` below makes that failure mode an
 * executable assertion rather than a comment, so a later edit that "generalises"
 * this pin to a prototype-reachable name turns the suite red instead of
 * hollowing it out.
 *
 * ## ⭐ Why every fixture here is built by `JSON.parse`
 *
 * Writing the fixture as an object literal would silently void this file.
 * `{ __proto__: def }` in source is the prototype-setter form: it sets the
 * literal's prototype and creates NO own property, so `readFields` would emit
 * no entry and there would be nothing for `writeFields` to lose. Stored
 * metadata arrives over the wire as JSON, and `JSON.parse` creates a real own
 * property — that is both the faithful construction and the only one that
 * carries the defect. `the instrument` below asserts it rather than trusting
 * it.
 *
 * ⛔ Do not assert on `ObjectSchema.safeParse(...).data`. Measured on zod
 * 4.4.3: `z.record()` reports success and hands back an output object with the
 * `__proto__` entry MISSING — the same construction defect, one layer up, in a
 * dependency. Asserting on the validator's output instead of on the document
 * we built would make this file permanently red for a reason that has nothing
 * to do with `writeFields`.
 */

/** The round trip every draft read/write in the object designer goes through. */
const roundTrip = (fieldsInput: unknown) => writeFields(readFields(fieldsInput));

/**
 * A stored `fields` map exactly as it arrives from
 * `GET /api/v1/meta/object/:name` — JSON text, parsed. The prototype-reachable
 * name sits BETWEEN two ordinary ones so the control travels in the same case,
 * through the same call, in the same order.
 */
/*
 * ⛔ Written as JSON TEXT, never as `JSON.stringify({ __proto__: … })`. That
 * argument would be the prototype-setter literal, `stringify` would emit no
 * such key, and this file would pass while measuring nothing.
 */
const STORED_JSON =
  '{"title":{"type":"text","label":"Title"},'
  + '"__proto__":{"type":"number","label":"Proto"},'
  + '"owner_ref":{"type":"text","label":"Owner"}}';

const storedFields = () => JSON.parse(STORED_JSON) as Record<string, unknown>;

/** `writeFields`' record-shape output as the wire sees it. */
const emittedBody = (fields: unknown) => ({
  name: 'account',
  label: 'Account',
  fields: roundTrip(fields),
});

describe('the instrument', () => {
  it('the stored fixture really carries `__proto__` as an OWN enumerable property', () => {
    // Without this, a fixture rewritten into the object-literal form would
    // make every assertion below vacuously green.
    const stored = storedFields();
    expect(Object.keys(stored)).toEqual(['title', '__proto__', 'owner_ref']);
    expect(Object.prototype.hasOwnProperty.call(stored, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
  });

  it('`readFields` surfaces it as an entry — the read half was never the defect', () => {
    // objectui#9237 measured `readFields` correct and the card's acceptance
    // forbids touching it. This is the assertion that keeps that true: if the
    // read door ever starts losing the key, the write-side pin below would go
    // green for the wrong reason.
    expect(readFields(storedFields()).entries.map((e) => e.name)).toEqual(['title', '__proto__', 'owner_ref']);
  });

  it('the name table: only `__proto__` survives blind assignment, so only it can pin this', () => {
    // Reproduces the defect locally, against plain assignment, independent of
    // `writeFields`. Every row but the first is green BY CONSTRUCTION — that
    // is the whole reason the acceptance on objectui#9237 names `__proto__`
    // verbatim and refuses `constructor` and friends as substitutes.
    const survivesBlindAssignment = (name: string): boolean => {
      const out: Record<string, unknown> = {};
      out[name] = { marker: true };
      return Object.prototype.hasOwnProperty.call(out, name);
    };
    expect(survivesBlindAssignment('__proto__')).toBe(false);
    for (const name of ['constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf', 'title']) {
      expect([name, survivesBlindAssignment(name)]).toEqual([name, true]);
    }
  });
});

describe('the full round trip — `readFields` then `writeFields`', () => {
  it('⭐ keeps a stored field named `__proto__`, alongside its ordinary-name controls', () => {
    const body = roundTrip(storedFields()) as Record<string, unknown>;
    // Own keys, not `in` — the point is that the entry is an own property of
    // the emitted map and not a prototype reached through it.
    expect(Object.keys(body)).toEqual(['title', '__proto__', 'owner_ref']);
    expect(Object.prototype.hasOwnProperty.call(body, '__proto__')).toBe(true);
    // Read through the descriptor: plain `.` / `[]` access on this one name is
    // ambiguous between the own property and `Object.prototype`'s accessor.
    expect(Object.getOwnPropertyDescriptor(body, '__proto__')?.value).toEqual({ type: 'number', label: 'Proto' });
  });

  it('⭐ the wire bytes carry it — `JSON.stringify` is what the PUT actually sends', () => {
    // The own-key assertion above and this one are not the same statement: a
    // non-enumerable own property would satisfy that one and vanish here, and
    // the body is serialized before it is sent.
    const sent = JSON.parse(JSON.stringify(roundTrip(storedFields()))) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(['title', '__proto__', 'owner_ref']);
  });

  it('the spec still ACCEPTS the mutilated body — which is exactly why the loss was silent', () => {
    // This half is the severity, not the repair. `fields`' key grammar is
    // /^[a-z_][a-z0-9_]*$/, which admits `__proto__`, and through
    // `@objectstack/spec` 17.4.0 `ObjectSchema` ACCEPTED the body with the field
    // AND without it. 17.5.0 refuses the KEPT key by name (`z.record()` would
    // drop it from its output while reporting success) — but it still accepts
    // the body that already lost it, so the validator can still never notice
    // the loss, and the pins above remain the only instrument there is. What
    // the repair buys since 17.5.0 is that the refusal reaches the author at
    // all (objectui#11073 re-pin).
    const kept = ObjectSchema.safeParse(emittedBody(storedFields()));
    expect(kept.success ? [] : kept.error.issues.map((i) => `${i.code} @ ${i.path.join('.')}`)).toEqual([
      'custom @ fields.__proto__',
    ]);
    const mutilated = { name: 'account', label: 'Account', fields: { title: { type: 'text', label: 'Title' } } };
    expect(ObjectSchema.safeParse(mutilated).success).toBe(true);
  });

  it('control: nothing about ordinary names changed', () => {
    const ordinary = JSON.parse('{"title":{"type":"text","label":"Title"},"owner_ref":{"type":"text","label":"Owner"}}');
    const body = roundTrip(ordinary) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['title', 'owner_ref']);
    // Parsed on the ORDINARY body: this row used to parse the `__proto__`
    // fixture, which answered the same as this one only while the spec still
    // accepted that name (through 17.4.0; objectui#11073).
    expect(ObjectSchema.safeParse(emittedBody(ordinary)).success).toBe(true);
  });

  it('control: the array shape carries the name as a VALUE and was never affected', () => {
    // `writeFields`' array branch emits `{ name, ...def }`, so the field name
    // is never used as a key there. Pinning it keeps the repair honest about
    // which branch it changed.
    const view = readFields(JSON.parse('[{"name":"__proto__","type":"number"},{"name":"title","type":"text"}]'));
    expect(view.shape).toBe('array');
    expect(writeFields(view)).toEqual([
      { name: '__proto__', type: 'number' },
      { name: 'title', type: 'text' },
    ]);
  });
});
