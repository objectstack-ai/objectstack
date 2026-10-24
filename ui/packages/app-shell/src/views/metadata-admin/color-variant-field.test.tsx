// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The designer's swatch palette ↔ the spec's `colorVariant` enum (objectui#3359).
 *
 * `COLOR_VARIANTS`' header calls itself "Canonical semantic palette (mirrors the
 * renderer's colorVariant tokens)" — a claim that was, until #3359, unverifiable
 * on the renderer side: `DatasetWidget` read `colorVariant` nowhere, so the
 * dataset-bound metric card had no tokens to mirror. Wiring the renderer up
 * closed that gap and opened a sharper one: three lists now state the same
 * vocabulary — this picker, the spec enum (`WidgetColorVariantSchema`), and
 * `plugin-dashboard/src/colorVariants.ts` — and a silent disagreement between
 * them would trade a declared-but-unenforced key for a declared-two-ways key,
 * which is harder to find because every surface looks correct on its own.
 *
 * So the canonical row is pinned here against the spec itself, in the SAME order
 * (the picker renders it as a swatch row; the order is what the admin sees).
 * The renderer's own table is pinned to the same enum in
 * `plugin-dashboard/src/__tests__/DatasetWidget.colorVariant.test.tsx`; between
 * the two, all three lists are held to one source.
 */

import { describe, it, expect } from 'vitest';
import { WidgetColorVariantSchema } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import { COLOR_VARIANTS, colorVariantCss } from './color-variant-field';

const specVariants: string[] = enumOptions(WidgetColorVariantSchema);

/**
 * The picker's canonical row — `ColorVariantPicker` renders exactly
 * `COLOR_VARIANTS.slice(0, 8)`, so this is the slice that has to match the spec.
 */
const CANONICAL_COUNT = 8;

describe('color-variant-field ↔ spec colorVariant enum', () => {
  it('reads a non-empty enum from the spec', () => {
    // Guards against the parity assertions passing vacuously against [].
    expect(specVariants, 'could not read WidgetColorVariantSchema.options from the spec').not.toEqual([]);
  });

  it('offers the spec tokens, in the spec order, as its canonical swatch row', () => {
    expect(COLOR_VARIANTS.slice(0, CANONICAL_COUNT).map((c) => c.value)).toEqual(specVariants);
    expect(specVariants).toHaveLength(CANONICAL_COUNT);
  });

  it('gives every canonical token a distinct, labelled swatch', () => {
    const canonical = COLOR_VARIANTS.slice(0, CANONICAL_COUNT);
    for (const variant of canonical) {
      expect(variant.label, `token ${variant.value} has no label`).toBeTruthy();
      expect(variant.css, `token ${variant.value} has no css colour`).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // `default` is the neutral swatch; the seven accents must be visually
    // distinguishable from each other in the picker.
    const accents = canonical.filter((c) => c.value !== 'default').map((c) => c.css);
    expect(new Set(accents).size).toBe(accents.length);
  });

  /**
   * The entries past the canonical 8 are the file's declared display-only
   * aliases. They exist so a swatch can still be drawn for an OFF-SPEC stored
   * value; they are deliberately outside the picker's own row and are NOT
   * renderer vocabulary (`metricAccentTextClass` ignores them). Pinning them as
   * aliases is what keeps a future edit from quietly promoting one into a ninth
   * authorable variant the spec never declared.
   */
  it('keeps its extra entries as off-spec display aliases, never new tokens', () => {
    const extras = COLOR_VARIANTS.slice(CANONICAL_COUNT);
    for (const extra of extras) {
      expect(specVariants, `${extra.value} is a spec token and must join the canonical row`).not.toContain(extra.value);
      // An alias only earns its place by re-using a canonical token's colour.
      const canonicalCss = COLOR_VARIANTS.slice(0, CANONICAL_COUNT).map((c) => c.css);
      expect(canonicalCss, `alias ${extra.value} paints a colour no canonical token uses`).toContain(extra.css);
    }
  });

  it('resolves hex values as-is and unknown tokens to the neutral swatch', () => {
    expect(colorVariantCss('#1f2937')).toBe('#1f2937');
    expect(colorVariantCss('chartreuse')).toBe(colorVariantCss('default'));
    expect(colorVariantCss(undefined)).toBe(colorVariantCss('default'));
  });
});
