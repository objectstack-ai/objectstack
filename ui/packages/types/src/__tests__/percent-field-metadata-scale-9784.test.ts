// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9784 — `scale` is a DECLARED member of `PercentFieldMetadata`.
 *
 * ## The defect this file pins the repair of
 *
 * The percent face declared `precision` / `min` / `max` and NOT `scale`, while
 * `scale` is the member the percent CELL renderer actually reads for its
 * decimal width (`@object-ui/fields`' `PercentCellRenderer`, corrected from
 * `precision` to `scale` by objectui#9295). So an author reading the published
 * type wrote `precision`, and silently got zero decimal places: the only key
 * that did anything was the one the declaration never mentioned.
 *
 * ## Why the shape needed no design
 *
 * `NumberFieldMetadata`, in this same file and above this one, already declares
 * BOTH members and spells the distinction out in its own docblocks. This card
 * copies that form onto the percent arm; the `scale` docblock is taken from the
 * number arm VERBATIM, and the parity assertion below is what keeps the two
 * from drifting into two different explanations of one `decimal(p, s)` column.
 *
 * ## `precision` is NOT touched, and that is a reading, not an omission
 *
 * The installed `@objectstack/spec` declares `precision` and `scale` as a PAIR
 * on its field face (`FieldSchema`: "Total digits (non-negative integer)" and
 * "Decimal places (non-negative integer)"), and its door accepts BOTH on a
 * `percent` field document — pinned at runtime below. So `precision` is a
 * spec-legal declaration on this face and staying is the spec-conformant state;
 * narrowing or retiring it would move a published accept set, which this card
 * is explicitly not chartered to do.
 *
 * ## Why the membership pins are type-level
 *
 * House form for this file's neighbours (see
 * `field-metadata-depends-on-declared-6153.test.ts`): plain interfaces, no index
 * signature and no zod mirror for `field-types.ts`, so an undeclared member read
 * is a compile error and `Equal` cannot be satisfied by an index-signature
 * fallback. Those pins bite under `tsc -p tsconfig.test.json` (this package's
 * `type-check` chain), NOT under the vitest runtime — which is why the runtime
 * half below pins the DECLARATION TEXT, the read site, and the installed spec's
 * answer, so the card's substance fails on both instruments.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FieldSchema } from '@objectstack/spec/data';

import type { NumberFieldMetadata, PercentFieldMetadata } from '../field-types';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/* ── Type-level helpers (invariant equality, house form) ─────────────────── */

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── 1. The declared member, in the number arm's shape ───────────────────── */

export type _ScaleIsDeclaredOnPercent = Expect< Equal< PercentFieldMetadata['scale'], number | undefined > >;
// Same member, same shape as the arm this card copied — if one moves, this says so.
export type _ScaleMatchesTheNumberArm = Expect< Equal< PercentFieldMetadata['scale'], NumberFieldMetadata['scale'] > >;
// The neighbour this card did NOT touch is still declared, still the same shape.
export type _PrecisionUntouched = Expect< Equal< PercentFieldMetadata['precision'], NumberFieldMetadata['precision'] > >;

/* ── 2. The authoring proof: an annotated literal carries the key ────────── */
// This assignment is the excess-property check that FAILED before the
// declaration landed — an author (human or AI) could not legally write the one
// member the percent renderers honour. Compiling at all is the assertion.

export const _percentAuthoredWithScale: PercentFieldMetadata = {
  type: 'percent',
  name: 'discount_rate',
  label: 'Discount Rate',
  scale: 2,
  min: 0,
  max: 1,
};

// `precision` stays authorable alongside it; the two are not exclusive.
export const _percentAuthoredWithBothDigitCounts: PercentFieldMetadata = {
  ..._percentAuthoredWithScale,
  precision: 10,
};

// The face is still strict — the declaration widened by exactly one member.
export const _misspellingIsStillRefused: PercentFieldMetadata = {
  type: 'percent',
  name: 'discount_rate',
  // @ts-expect-error — objectui#9784 declared `scale`, not `scaleDigits`; the percent face admits no near-miss spelling
  scaleDigits: 2,
};

/* ── 3. The declaration TEXT, and its parity with the number arm ─────────── */

const FIELD_TYPES = join(REPO_ROOT, 'packages/types/src/field-types.ts');

/** The body of `export interface NAME extends BaseFieldMetadata { … }`. */
function interfaceBody(src: string, name: string): string {
  const open = src.indexOf(`export interface ${name} extends BaseFieldMetadata {`);
  if (open === -1) throw new Error(`interface ${name} not found in field-types.ts`);
  const close = src.indexOf('\n}', open);
  if (close === -1) throw new Error(`unterminated interface ${name} in field-types.ts`);
  return src.slice(open, close);
}

/** The single-line docblock immediately above `member?:` inside `body`. */
function docblockAbove(body: string, member: string): string | undefined {
  const lines = body.split('\n');
  const at = lines.findIndex((l) => l.trim().startsWith(`${member}?:`));
  if (at <= 0) return undefined;
  const above = lines[at - 1].trim();
  return above.startsWith('/**') && above.endsWith('*/') ? above : undefined;
}

describe('objectui#9784 — the percent face declares `scale`, copied from the number arm', () => {
  const src = readFileSync(FIELD_TYPES, 'utf8');
  const percent = interfaceBody(src, 'PercentFieldMetadata');
  const number = interfaceBody(src, 'NumberFieldMetadata');

  it('control: the number arm — the form this card copied — declares `scale`', () => {
    // Without this leg the assertion below cannot tell "percent declares it"
    // from "this extractor reads nothing at all".
    expect(number, 'NumberFieldMetadata no longer declares `scale`').toContain('scale?: number;');
  });

  it('`PercentFieldMetadata` declares `scale`', () => {
    expect(percent, 'PercentFieldMetadata no longer declares `scale`').toContain('scale?: number;');
  });

  it('the `scale` docblock says the same thing on both arms — one `decimal(p, s)`, one explanation', () => {
    const percentDoc = docblockAbove(percent, 'scale');
    const numberDoc = docblockAbove(number, 'scale');
    expect(numberDoc, 'the number arm lost its `scale` docblock — the control for this parity').toBeDefined();
    expect(percentDoc, 'the percent arm declares `scale` with no docblock').toBeDefined();
    expect(percentDoc).toBe(numberDoc);
    // The substance, spelled out so a rewrite of BOTH arms still has to mean it:
    expect(percentDoc).toContain('Number of decimal places to display');
    expect(percentDoc).toContain('decimal(p, s)');
  });

  it('`precision` is still declared on the percent face — this card moved no accept set', () => {
    expect(percent, 'PercentFieldMetadata lost `precision`; objectui#9784 did not authorize that').toContain(
      'precision?: number;',
    );
  });
});

/* ── 4. The read site the declaration records ────────────────────────────── */

describe('objectui#9784 — the percent cell renderer reads `scale` off the field', () => {
  const CELL = 'packages/fields/src/index.tsx';
  const src = readFileSync(join(REPO_ROOT, CELL), 'utf8');

  it('the read still exists — the fact this declaration was catching up to', () => {
    // Pinned as the READ, not as the whole expression: objectui#9808's clamp
    // reshaped the expression around this member without ending the read, and
    // retiring it at its SUNSET (objectui#11073) did the same.
    expect(src, `${CELL} no longer reads \`scale\` off the percent field`).toMatch(/percentField\.scale\b/);
  });

  it('the renderer does not read `precision` for the percent decimal width (objectui#9295)', () => {
    expect(src, `${CELL} reads \`precision\` for percent decimals again`).not.toMatch(/percentField\.precision\b/);
  });
});

/* ── 5. The installed spec's answer (two-control probe) ──────────────────── */

const percentDocument = {
  name: 'discount_rate',
  type: 'percent',
  label: 'Discount Rate',
  scale: 2,
};

describe('installed @objectstack/spec — `scale` and `precision` on a percent field document', () => {
  it('control: the door is strict — a bogus key on the same document is refused BY NAME', () => {
    const res = FieldSchema.safeParse({ ...percentDocument, percentScaleBogusKey9784: true });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(
      res.error.issues.find(
        (i) =>
          i.code === 'unrecognized_keys' &&
          ((i as { keys?: string[] }).keys ?? []).includes('percentScaleBogusKey9784'),
      ),
      'the spec door admitted an unknown key — this probe proves nothing',
    ).toBeDefined();
  });

  it('a percent field declaring `scale` is accepted — the type now admits what the door does', () => {
    expect(FieldSchema.safeParse(percentDocument).success).toBe(true);
  });

  it('a percent field declaring `precision` is ALSO accepted — why `precision` stays', () => {
    const { scale, ...rest } = percentDocument;
    void scale;
    expect(FieldSchema.safeParse({ ...rest, precision: 10 }).success).toBe(true);
  });

  it('`scale` is a digit COUNT at the door: a non-integer is refused', () => {
    expect(FieldSchema.safeParse({ ...percentDocument, scale: 2.5 }).success).toBe(false);
  });
});
