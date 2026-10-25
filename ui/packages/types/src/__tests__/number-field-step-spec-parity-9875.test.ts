/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9875 — `step` on the OBJECT FIELD surface: measured, not assumed.
 *
 * ## The question the card asked, and the answer
 *
 * The card was filed as a QUESTION with one leg unmeasured: an author writes
 * `step` on a platform FIELD — does the key reach the renderer (preserved), get
 * dropped without a diagnostic (stripped), or get refused by name (refused)?
 *
 * Measured here against the INSTALLED `@objectstack/spec`, at both doors this
 * repo actually uses: **PRESERVED — because the protocol DECLARES it.** `step`
 * is a member of `FieldSchema`'s accept set, it survives a `safeParse` with its
 * value intact, and it survives nested inside `ObjectSchema.fields` (the schema
 * `@objectstack/client`'s `saveMetaItem` resolves for a metadata item of type
 * `object`, and the one that answers a designer save with 422
 * `INVALID_METADATA` when it refuses). The read path's `stripReadDecorations`
 * leaves it alone too, because that strip owns FRAMEWORK keys, never author
 * keys.
 *
 * ## The card's premise was FALSE, and this file is the correction
 *
 * The card reported `0` `step` members on the object-field surface, reading the
 * spec's two declarations as belonging to "the inline-grid column node" and
 * "the slider node". Only the first of those is a nested node
 * (`InlineGridColumnSchema`). **There is no slider node**: the spec models a
 * slider as a field `type`, so the declaration whose prose reads "Step
 * increment for slider" is a FLAT member of `FieldSchema` itself — i.e. of the
 * object-field surface, structurally reachable from every field type. The
 * slider wording is documentation of its intended use, not a structural fence,
 * and the assertions below read the accept set rather than the prose so the
 * same mis-attribution cannot be made twice.
 *
 * ⇒ There is NO declaration asymmetry for `NumberFieldMetadata.step`. The
 * renderer-side type mirrors a key the protocol genuinely declares.
 *
 * ## ⚠️ What this file does NOT do
 *
 * It repairs nothing. `NumberFieldMetadata.step` is not removed (it is a
 * published capability with a live reader), and no key is ADDED to any
 * published type or zod surface. What it does is fix the measured behaviour in
 * place so it cannot drift unnoticed in EITHER direction: if a spec release
 * ever drops `step` from the field surface, or starts refusing it by name, the
 * runtime block goes red here instead of going quiet.
 *
 * The one real asymmetry this measurement DID surface is recorded at the end —
 * on `SliderFieldMetadata`, which is the opposite direction. It was reported
 * rather than repaired here, because the repair enlarges a published type; it
 * was repaired separately by objectui#10066, and section 4 pins the result.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FieldSchema, ObjectSchema } from '@objectstack/spec/data';
import { stripReadDecorations } from '@objectstack/spec/kernel';

import type { NumberFieldMetadata, SliderFieldMetadata } from '../field-types';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/* ── Type-level helpers (invariant equality, house form) ─────────────────── */

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── 1. The renderer-side declaration ────────────────────────────────────── */

export type _StepIsDeclaredOnNumberMetadata = Expect< Equal< NumberFieldMetadata['step'], number | undefined > >;

// The authoring proof: an annotated literal carrying the key. Compiling at all
// is the assertion — this is the excess-property check an author (human or AI)
// meets when writing the metadata the card was worried about.
export const _numberFieldWithStep: NumberFieldMetadata = {
  type: 'number',
  name: 'amount',
  label: 'Amount',
  scale: 2,
  step: 0.5,
};

/* ── 2. The installed spec's answer, with both controls ──────────────────── */

/** The `unrecognized_keys` issue naming `key`, or undefined. */
function refusedByName(res: ReturnType<typeof FieldSchema.safeParse>, key: string) {
  if (res.success) return undefined;
  return res.error.issues.find(
    (i) => i.code === 'unrecognized_keys' && ((i as { keys?: string[] }).keys ?? []).includes(key),
  );
}

/** The base document every probe below varies — a plain number field. */
const NUMBER_FIELD = { name: 'amount', type: 'number', label: 'Amount' } as const;

describe('installed @objectstack/spec — `step` on the object FIELD surface (objectui#9875)', () => {
  it('control: the base document parses green, so a later refusal is about the KEY', () => {
    expect(FieldSchema.safeParse(NUMBER_FIELD).success).toBe(true);
  });

  it('control: the door is STRICT — a key nobody declares is refused BY NAME, not stripped', () => {
    // Load-bearing for every assertion below: on a stripping schema a surviving
    // key would prove nothing, because the same green would follow either way.
    const res = FieldSchema.safeParse({ ...NUMBER_FIELD, zzzDefinitelyNotAKey9875: 1 });
    expect(refusedByName(res, 'zzzDefinitelyNotAKey9875')).toBeDefined();
  });

  it('`step` is IN the accept set of the field surface itself — not confined to a nested node', () => {
    const accept = new Set(Object.keys(FieldSchema.shape as Record<string, unknown>));
    expect(accept.has('step')).toBe(true);
    // The lit control the card itself used, on the same instrument: the keys
    // whose presence nobody disputes are in the same flat accept set.
    expect(accept.has('scale')).toBe(true);
    expect(accept.has('precision')).toBe(true);
  });

  it('the member carries the SLIDER prose — the wording that made the card read it as a nested node', () => {
    // Recorded, because the mis-attribution is the card's actual defect and a
    // reader who checks the prose alone would repeat it. The prose is
    // documentation of intended use; the accept set above is the structure.
    const described = (FieldSchema.shape as Record<string, { description?: string }>).step;
    expect(described?.description ?? '').toContain('slider');
  });

  it('PRESERVED: one invocation carries the subject AND the lit control, and both come back', () => {
    // `scale` is the lit control — a key the protocol indisputably declares on
    // this same surface. If the run were dead, it would vanish too.
    const res = FieldSchema.safeParse({ ...NUMBER_FIELD, scale: 2, step: 0.5 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    const out = res.data as Record<string, unknown>;
    expect(out.step).toBe(0.5);
    expect(out.scale).toBe(2);
  });

  it('it is a NUMBER: the HTML `step="any"` spelling is refused at the value level', () => {
    // Which is why `NumberField` derives `'any'` at the widget rather than
    // letting an author declare it in metadata.
    expect(FieldSchema.safeParse({ ...NUMBER_FIELD, step: 'any' }).success).toBe(false);
    expect(FieldSchema.safeParse({ ...NUMBER_FIELD, step: 0 }).success).toBe(true);
  });
});

describe('the save door: `ObjectSchema`, the schema `saveMetaItem` parses a type `object` item against', () => {
  const objectDocument = (field: Record<string, unknown>) => ({
    name: 'probe_object_9875',
    label: 'Probe',
    fields: { amount: { type: 'number', label: 'Amount', ...field } },
  });

  it('control: an undeclared key nested in `fields` is refused BY NAME at the nested path', () => {
    const res = ObjectSchema.safeParse(objectDocument({ zzzDefinitelyNotAKey9875: 1 }));
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(
      res.error.issues.some(
        (i) => i.code === 'unrecognized_keys' && i.path.join('.') === 'fields.amount',
      ),
    ).toBe(true);
  });

  it('PRESERVED through the whole item, subject and lit control together', () => {
    const res = ObjectSchema.safeParse(objectDocument({ scale: 2, step: 0.5 }));
    expect(res.success).toBe(true);
    if (!res.success) return;
    const amount = (res.data as { fields: Record<string, Record<string, unknown>> }).fields.amount;
    expect(amount.step).toBe(0.5);
    expect(amount.scale).toBe(2);
  });
});

describe('the read door: `stripReadDecorations` drops FRAMEWORK keys, never author keys', () => {
  it('leaves `step` (and the lit control) on the served field, while eating a decoration', () => {
    const served = {
      name: 'probe_object_9875',
      label: 'Probe',
      _diagnostics: { anything: true },
      fields: { amount: { type: 'number', label: 'Amount', scale: 2, step: 0.5 } },
    };
    const out = stripReadDecorations(served) as typeof served;
    // The lit control for the strip itself: it really did remove something.
    expect('_diagnostics' in out).toBe(false);
    expect(out.fields.amount.step).toBe(0.5);
    expect(out.fields.amount.scale).toBe(2);
  });
});

/* ── 3. The read site the declaration exists for ─────────────────────────── */

describe('objectui#9875 — the reader that makes `NumberFieldMetadata.step` a live member', () => {
  it('`NumberField` still reads the metadata key as an override over its derived value', () => {
    const src = readFileSync(join(REPO_ROOT, 'packages/fields/src/widgets/NumberField.tsx'), 'utf8');
    expect(src).toContain("typeof numberField?.step === 'number'");
  });
});

/* ── 4. The slider half of the same key — declared by objectui#10066 ────── */

/**
 * The card looked for a renderer key the protocol lacks and there is none. The
 * measurement turned up the MIRROR IMAGE on the neighbouring face: the protocol
 * declares `step` (with slider prose, no less), `SliderField` reads it, and
 * `SliderFieldMetadata` declared no such member, so an author could not write
 * the slider's own documented key under the published type.
 *
 * objectui#10066 closed that gap by declaring the member (the undeclared key
 * follows the implementation). The pins below hold it from both sides: the
 * annotated literal carrying `step` compiling at all is the positive assertion,
 * and the misspelled key under `@ts-expect-error` proves the excess-property
 * check is still live on this interface — if the interface ever widened to an
 * index signature, that directive would become unused and `tsc` would say so.
 */
export type _StepIsDeclaredOnSliderMetadata = Expect< Equal< SliderFieldMetadata['step'], number | undefined > >;

export const _sliderMetadataWithStep: SliderFieldMetadata = {
  type: 'slider',
  name: 'progress',
  min: 0,
  max: 100,
  step: 5,
};

export const _sliderMetadataRefusesMisspelledStep: SliderFieldMetadata = {
  type: 'slider',
  name: 'progress',
  // @ts-expect-error — objectui#10066: a misspelled key is refused by the excess-property check; only the declared `step` is accepted.
  stpe: 5,
};

describe('objectui#9875 — the slider half of the same key', () => {
  it('`SliderField` reads `step` off the field carrier — the read the declaration covers', () => {
    const src = readFileSync(join(REPO_ROOT, 'packages/fields/src/widgets/SliderField.tsx'), 'utf8');
    expect(src).toContain('const step = sliderField?.step ?? 1;');
  });

  it('and the protocol accepts it on a slider field document, so the read is honoured end to end', () => {
    const res = FieldSchema.safeParse({ name: 'progress', type: 'slider', label: 'Progress', step: 5 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect((res.data as Record<string, unknown>).step).toBe(5);
  });
});
