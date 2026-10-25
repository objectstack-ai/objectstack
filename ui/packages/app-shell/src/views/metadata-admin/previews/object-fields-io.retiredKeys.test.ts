// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins that the object designer's field IO never carries a retired FieldSchema
 * key back out (objectui#4644 for `indexed`, objectui#6519 for its siblings).
 *
 * Each key here is refused BY NAME by `FieldSchema` — measured on the installed
 * `@objectstack/spec` 17.2.0:
 *
 *   indexed      "never a FieldSchema key; a field-level index flag built no
 *                index (#2377). Declare the index in the object's `indexes[]`."
 *   referenceTo  "Did you mean `referenceTo` -> `reference`?"
 *   isSystem     "Did you mean `isSystem` -> `system`?"
 *
 * Measured on console 17.0.0 GA for `indexed`: the field inspector shipped an
 * `Indexed` checkbox writing the key, and saving the draft came back
 * `HTTP 422 {"code":"INVALID_METADATA"}` — the toggle stayed ticked, so every
 * later save of that object stayed blocked too. The two siblings added by
 * objectui#6519 are the same shape from the same era: each was written by a
 * shipped designer build (see the per-key evidence on `RETIRED_FIELD_KEYS`), so
 * a stored object can still carry it inside a field.
 *
 * The two keys the spec refuses that this door deliberately does NOT strip —
 * `formula` and `sortOrder` — have a case each below, because the temptation to
 * "finish the set" is exactly what those two paragraphs of the tombstone exist
 * to stop.
 *
 * Retiring the control is only half of it. `readFields` deliberately preserves
 * unknown keys and every write path spreads the def it read, so a draft
 * authored before the retirement would carry the key straight back out to
 * `PUT /api/v1/meta/object/:name` with no control left on screen to clear it.
 * Stripping on load is what un-breaks those saves — which is why the pins
 * below are round-trips (`readFields` -> `writeFields`), not just reads.
 *
 * Both draft shapes are covered because `readFields` normalises two of them
 * (array and record) through separate branches.
 */

import { describe, it, expect } from 'vitest';
import { readFields, writeFields, RETIRED_FIELD_KEYS } from './object-fields-io';

/** Round-trip a `draft.fields` value the way every designer write path does. */
function roundTrip(fields: unknown) {
  return writeFields(readFields(fields));
}

/** A representative value per key, as the retired control actually wrote it. */
const SAMPLE: Record<(typeof RETIRED_FIELD_KEYS)[number], unknown> = {
  indexed: true,
  referenceTo: 'account',
  isSystem: true,
};

/**
 * What is left on `{ type: 'lookup', label: 'Owner' }` after the door has seen
 * that key — the falsification half of each case below, and the one place the
 * three keys stop being interchangeable (objectui#8896).
 *
 * `indexed` and `isSystem` leave NOTHING behind, for two different recorded
 * reasons: the field-level index flag built no index at all (objectui#4644 —
 * the concept moved to the object's `indexes[]`, so there is no field-level
 * value to keep), and the system flag's spec spelling `system` is a separate
 * key the draft either carries or does not, so the strip IS the whole write
 * half of objectui#6044 and re-stamping it would invent a flag the author
 * never set.
 *
 * `referenceTo` is the one whose VALUE the draft may hold nowhere else. It is
 * the same CONCEPT as `reference` and the same KIND of value — a bare object
 * name — so deleting it destroyed the only copy of a relationship target and
 * left the designer's target editor empty. The door keeps that value under the
 * spec spelling now; the retired key is dropped exactly as the other two are,
 * which is what every `key in out` assertion below is stating.
 */
const RESIDUE: Record<(typeof RETIRED_FIELD_KEYS)[number], Record<string, unknown>> = {
  indexed: {},
  referenceTo: { reference: 'account' },
  isSystem: {},
};

describe('object-fields-io · retired FieldSchema keys (objectui#4644, objectui#6519)', () => {
  it('names exactly the three keys this door strips', () => {
    // The list is derived from the tombstone registry (objectui#6527:
    // `RETIRED_FIELD_KEY_TOMBSTONES` in `@object-ui/types`, site
    // `metadataAdminFieldsReadDoor`), and its two ABSENCES are deliberate:
    //   `formula`   — premise holds, strip refused: ObjectFieldInspector
    //                 migrates the legacy key through its linting CEL editor,
    //                 and stripping empties that editor (measured: the pin
    //                 `commits edits to \`expression\` …` goes red).
    //   `sortOrder` — premise fails: no writer on this tree ever populated a
    //                 field-level one, so no draft can carry it and a strip
    //                 would be dead code that reads like a measurement.
    // Both have a case of their own below, and both are also pinned at the
    // registry itself (`retired-field-key-tombstones.test.ts` — `formula`'s
    // absence is the objectui#6526 option B ruling made mechanical). See the
    // registry before adding a fourth entry.
    expect([...RETIRED_FIELD_KEYS]).toEqual(['indexed', 'referenceTo', 'isSystem']);
  });

  for (const key of RETIRED_FIELD_KEYS) {
    it(`drops \`${key}\` from a record-shaped draft on round-trip`, () => {
      const out = roundTrip({
        owner_id: { type: 'lookup', label: 'Owner', [key]: SAMPLE[key] },
      }) as Record<string, Record<string, unknown>>;

      expect(key in out.owner_id).toBe(false);
      // Falsification: keyed to the tombstone, not a blanket unknown-key purge
      // — and, for the one key whose value has nowhere else to live, the value
      // survives under the spec spelling (see {@link RESIDUE}).
      expect(out.owner_id).toEqual({ type: 'lookup', label: 'Owner', ...RESIDUE[key] });
    });

    it(`drops \`${key}\` from an array-shaped draft on round-trip`, () => {
      const out = roundTrip([
        { name: 'owner_id', type: 'lookup', label: 'Owner', [key]: SAMPLE[key] },
      ]) as Array<Record<string, unknown>>;

      expect(key in out[0]).toBe(false);
      expect(out[0]).toEqual({ name: 'owner_id', type: 'lookup', label: 'Owner', ...RESIDUE[key] });
    });
  }

  it('drops every retired key at once — one poisoned field can carry several', () => {
    // A draft from the era when all four controls shipped carries all four, and
    // `unrecognized_keys` reports them together: clearing three of four leaves
    // the object exactly as blocked as before.
    const poisoned = Object.fromEntries(RETIRED_FIELD_KEYS.map((k) => [k, SAMPLE[k]]));
    const out = roundTrip({ owner_id: { type: 'lookup', label: 'Owner', ...poisoned } }) as Record<
      string,
      Record<string, unknown>
    >;

    expect(RETIRED_FIELD_KEYS.filter((k) => k in out.owner_id)).toEqual([]);
    // Every retired key is gone; the lookup's target is not, because it is a
    // VALUE and not a key — the asymmetry {@link RESIDUE} records.
    expect(out.owner_id).toEqual({ type: 'lookup', label: 'Owner', reference: 'account' });
  });

  it('drops falsy values too — the key itself is what the parse rejects', () => {
    // The GA rejection is `unrecognized_keys`: it fires on the key's presence,
    // so an un-ticked-but-persisted `false` blocks the save exactly as a
    // `true` does. Leaving falsy values behind would fix only half the drafts.
    const out = roundTrip({
      code: { type: 'text', indexed: false, isSystem: false, referenceTo: '', formula: '' },
    }) as Record<string, Record<string, unknown>>;
    expect(RETIRED_FIELD_KEYS.filter((k) => k in out.code)).toEqual([]);
  });

  it('leaves the spec spelling of each renamed concept untouched', () => {
    // `reference` and `system` are real `FieldSchema` keys — the strip is keyed
    // to the REFUSED spelling only. Dropping the accepted one instead would
    // silently delete a lookup's target and a field's system flag on every read.
    const out = roundTrip({
      owner_id: { type: 'lookup', label: 'Owner', reference: 'account', system: true, expression: 'a + b' },
    }) as Record<string, Record<string, unknown>>;

    expect(out.owner_id).toEqual({
      type: 'lookup',
      label: 'Owner',
      reference: 'account',
      system: true,
      expression: 'a + b',
    });
  });

  it('carries a legacy `formula` through — not stripped, on purpose', () => {
    // `FieldSchema` refuses `formula` by name as well, and a shipped control
    // wrote it, so unlike `sortOrder` the premise holds here. The strip is
    // refused for a different reason: `ObjectFieldInspector` seeds its CEL
    // editor from `def.expression ?? def.formula` and the first edit commits
    // `expression` and clears the alias, which is the migration objectui#6043
    // preserved when it refused to rename the key blindly. Stripping at this
    // door empties that editor and the authored source is gone on the next
    // save — measured: with `formula` in the list, that pin renders `""` and
    // fails. RULED, objectui#6526 option B (2026-08-27): the migration path
    // stands and the key is NOT stripped here; the 422 diagnostic points the
    // author at the formula editor instead (PR #6624).
    const out = roundTrip({
      total: { type: 'formula', formula: 'price * quantity' },
    }) as Record<string, Record<string, unknown>>;
    expect(out.total).toEqual({ type: 'formula', formula: 'price * quantity' });
  });

  it('carries a field-level `sortOrder` through — not stripped, on purpose', () => {
    // The deliberate asymmetry with `MetadataService`'s five-key `carryOver`.
    // `FieldSchema` refuses `sortOrder` by name as well, but no writer on this
    // tree ever populated a field-level one (objectui#6045 removed it as
    // objectui#4687's zero-readers/zero-writers shape, not objectui#6041's
    // rename), so no draft this door reads can carry it. This case is the
    // module's own contract stated on the key that most tempts a defensive
    // addition: strip the tombstoned keys, carry everything else. Evidence of a
    // stored field-level `sortOrder` would flip it — update the tombstone and
    // this pin together.
    const out = roundTrip({ code: { type: 'text', sortOrder: 3 } }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(out.code).toEqual({ type: 'text', sortOrder: 3 });
  });

  it('leaves every other unknown key on the field untouched', () => {
    // The module's contract is that the inspector only edits keys it knows
    // about — a live spec key it does not render (or one a newer spec adds)
    // must survive the round-trip, or retiring one key would quietly delete
    // authored metadata.
    const out = roundTrip({
      amount: {
        type: 'currency',
        label: 'Amount',
        indexed: true,
        precision: 18,
        scale: 2,
        someFutureSpecKey: { nested: true },
      },
    }) as Record<string, Record<string, unknown>>;

    expect(out.amount).toEqual({
      type: 'currency',
      label: 'Amount',
      precision: 18,
      scale: 2,
      someFutureSpecKey: { nested: true },
    });
  });

  it('strips across every field, not just the one being edited', () => {
    // Any single edit re-serialises the WHOLE fields collection, so a poisoned
    // sibling the author never opened would otherwise keep the save blocked.
    const out = roundTrip({
      a: { type: 'text', indexed: true },
      b: { type: 'text' },
      c: { type: 'lookup', referenceTo: 'account' },
      d: { type: 'text', isSystem: true },
    }) as Record<string, Record<string, unknown>>;

    expect(Object.values(out).some((d) => RETIRED_FIELD_KEYS.some((k) => k in d))).toBe(false);
    expect(Object.keys(out)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns the original def object when there is nothing to strip', () => {
    // Cheap identity guard: the strip must not churn every field's reference
    // on every read, or memo consumers keyed on the def re-render forever.
    const clean = { type: 'text', label: 'Name' };
    const view = readFields({ name: clean });
    expect(view.entries[0].def).toEqual(clean);
  });
});
