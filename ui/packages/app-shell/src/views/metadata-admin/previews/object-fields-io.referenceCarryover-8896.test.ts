// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8896 — the metadata-admin read door loses a relationship target
 * stored only under the retired `referenceTo` spelling.
 *
 * ## The claim this file falsifies, and where it is written
 *
 * `RETIRED_FIELD_KEYS`' own docblock in `object-fields-io.ts`:
 *
 *   > Nothing is lost on the way out: where the spec has a spelling for the
 *   > concept it is a SEPARATE key (`reference`, `system`) that is NOT stripped
 *   > and rides through untouched, which is what lets the designer read it back.
 *
 * and the tombstone registry's entry for the key
 * (`types/src/internal/retired-field-keys.ts`):
 *
 *   > The strip loses nothing — every write path re-emits the designer's target
 *   > under `reference`, and the read door's writers never emit the retired
 *   > spelling.
 *
 * Both hold only when the draft ALSO carries the spec spelling. A draft holding
 * the target ONLY as `referenceTo` has it deleted on load with nothing left
 * behind: `readFields` is the single read door for `draft.fields` across the
 * whole object designer, and `writeFields` writes each def back verbatim, so
 * the loss is committed on the next save. `ObjectFieldInspector`'s target
 * editor reads `def.reference` and renders EMPTY, and every reader downstream
 * of this door reads the canonical key alone — `resolveReferenceTo` was
 * deliberately reduced to `def.reference` by objectui#6837's ruling that
 * protocol normalization belongs on the server and the readers just execute
 * the protocol.
 *
 * ## What the repair is, and the two things it is NOT
 *
 * The retired KEY is still stripped — it must be: `FieldSchema` refuses
 * `referenceTo` by name, so carrying it out is the hard 422 the strip exists
 * to prevent. What changes is that the VALUE is recovered into the spec
 * spelling first, which is the same "recover at the door, read canonically
 * everywhere else" shape objectui#6837 settled on.
 *
 * ⛔ NOT a per-reader fallback arm. objectui#6837 deleted those on a maintainer
 * ruling and this file does not bring one back — the pins below assert on what
 * comes OUT of the door, and `resolveReferenceTo` keeps reading `reference`
 * alone.
 *
 * ⛔ NOT a generic `specEquivalent` migration driven off the registry. The
 * registry says so itself ("Documentation for the reader, NEVER an instruction
 * to migrate a value mechanically"), because objectui#6043 refused exactly that
 * for `formula`, whose value is a LANGUAGE and not a name.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';
import { readFields, writeFields, RETIRED_FIELD_KEYS } from './object-fields-io';
import { resolveReferenceTo } from '../inspectors/useDatasetFields';

/** Round-trip a `draft.fields` value the way every designer write path does. */
function roundTrip(fields: unknown) {
  return writeFields(readFields(fields));
}

const unrecognizedKeys = (result: ReturnType<typeof FieldSchema.safeParse>): string[] =>
  result.success
    ? []
    : result.error.issues
        .filter((i) => i.code === 'unrecognized_keys')
        .flatMap((i) => (i as unknown as { keys: string[] }).keys);

describe('the instrument', () => {
  it('the installed `FieldSchema` refuses `referenceTo` by name and accepts `reference`', () => {
    // Without this the recovery below could be "fixed" by simply carrying the
    // retired key through, which is the 422 this door exists to prevent.
    expect(unrecognizedKeys(FieldSchema.safeParse({ type: 'lookup', label: 'L', referenceTo: 'account' })))
      .toContain('referenceTo');
    expect(FieldSchema.safeParse({ type: 'lookup', label: 'L', reference: 'account' }).success).toBe(true);
  });

  it('`referenceTo` is one of the keys this door strips', () => {
    expect([...RETIRED_FIELD_KEYS]).toContain('referenceTo');
  });
});

describe('objectui#8896 · a target stored only as `referenceTo` survives the read door', () => {
  it('record-shaped draft: the value arrives under the spec spelling, the retired key does not', () => {
    const out = roundTrip({
      owner_id: { type: 'lookup', label: 'Owner', referenceTo: 'account' },
    }) as Record<string, Record<string, unknown>>;

    expect(out.owner_id).toEqual({ type: 'lookup', label: 'Owner', reference: 'account' });
    expect('referenceTo' in out.owner_id).toBe(false);
  });

  it('array-shaped draft: the same, through the other branch of the door', () => {
    const out = roundTrip([
      { name: 'owner_id', type: 'lookup', label: 'Owner', referenceTo: 'account' },
    ]) as Array<Record<string, unknown>>;

    expect(out[0]).toEqual({ name: 'owner_id', type: 'lookup', label: 'Owner', reference: 'account' });
    expect('referenceTo' in out[0]).toBe(false);
  });

  it('the def the designer reads carries the target, so the inspector renders it', () => {
    // The consumer-side statement of the same fact: every reader downstream of
    // this door reads `reference` alone, by objectui#6837's ruling.
    const view = readFields({ owner_id: { type: 'master_detail', label: 'Parent', referenceTo: 'invoice' } });
    expect(view.entries[0].def.reference).toBe('invoice');
    expect(resolveReferenceTo(view.entries[0].def)).toBe('invoice');
  });

  it('what comes out of the door parses through the real FieldSchema', () => {
    const out = roundTrip({
      owner_id: { type: 'lookup', label: 'Owner', referenceTo: 'account' },
    }) as Record<string, Record<string, unknown>>;

    const result = FieldSchema.safeParse(out.owner_id);
    expect(unrecognizedKeys(result)).toEqual([]);
    expect(result.success).toBe(true);
  });
});

/**
 * ⭐ The firing controls. Each one fails on a build that "fixed" this by
 * recovering unconditionally, and the first two also fail on a build that
 * simply stopped stripping the key.
 */
describe('objectui#8896 · firing controls', () => {
  it('the spec spelling WINS — a stale legacy value never overwrites a live target', () => {
    // A pre-objectui#6041 designer wrote both keys; the canonical one is the
    // one the author has been editing ever since.
    const out = roundTrip({
      owner_id: { type: 'lookup', label: 'Owner', reference: 'account', referenceTo: 'stale_legacy' },
    }) as Record<string, Record<string, unknown>>;

    expect(out.owner_id.reference).toBe('account');
    expect('referenceTo' in out.owner_id).toBe(false);
  });

  it('a field with NO usable target gains no invented one', () => {
    // `unrecognized_keys` fires on the key's PRESENCE, so an empty retired key
    // is real and stored. Recovering it would smuggle a target that names no
    // object past every gate downstream.
    const out = roundTrip({
      a: { type: 'lookup', label: 'A', referenceTo: '' },
      b: { type: 'lookup', label: 'B', referenceTo: '   ' },
      c: { type: 'text', label: 'C' },
    }) as Record<string, Record<string, unknown>>;

    expect('reference' in out.a).toBe(false);
    expect('reference' in out.b).toBe(false);
    expect('reference' in out.c).toBe(false);
    expect(RETIRED_FIELD_KEYS.filter((k) => k in out.a)).toEqual([]);
    expect(RETIRED_FIELD_KEYS.filter((k) => k in out.b)).toEqual([]);
  });

  it('the OTHER retired keys are still dropped with nothing left behind', () => {
    // The recovery is keyed to ONE tombstone, not to `specEquivalent` in
    // general: `isSystem` has a spec equivalent too and is deliberately not
    // recovered — its strip IS the whole write half of objectui#6044.
    const out = roundTrip({
      code: { type: 'text', label: 'Code', indexed: true, isSystem: true },
    }) as Record<string, Record<string, unknown>>;

    expect(out.code).toEqual({ type: 'text', label: 'Code' });
  });
});
