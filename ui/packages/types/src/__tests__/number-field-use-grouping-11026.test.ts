/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11026 — `useGrouping` is a DECLARED member of `NumberFieldMetadata`,
 * derived from `@objectstack/spec`'s `FieldSchema.useGrouping` by reference.
 *
 * `NumberCellRenderer` reads the key off the typed field, so the published
 * face has to carry it: otherwise an author writing an annotated
 * `NumberFieldMetadata` literal is refused the one key that now decides
 * grouping, and the renderer can only reach it through a cast.
 *
 * The type-level pins bite under `tsc -p tsconfig.test.json` (this package's
 * `type-check` chain), not under the vitest runtime. The runtime half reads
 * the installed spec's own door, so a spec release that retypes or drops the
 * key goes red here as well.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema, type Field as SpecField } from '@objectstack/spec/data';

import type { NumberFieldMetadata } from '../field-types';

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── The declared member, in the spec's own type ──────────────────────────── */

export type _UseGroupingMirrorsTheSpec = Expect< Equal< NumberFieldMetadata['useGrouping'], SpecField['useGrouping'] > >;
export type _UseGroupingIsABoolean = Expect< Equal< NumberFieldMetadata['useGrouping'], boolean | undefined > >;

// The authoring proof: an annotated literal carries the key.
export const _yearAuthoredUngrouped: NumberFieldMetadata = {
  type: 'number',
  name: 'fiscal_year',
  label: 'Fiscal Year',
  scale: 0,
  useGrouping: false,
};

// The face stays strict: a non-boolean is refused, as the spec's door refuses it.
export const _stringIsRefused: NumberFieldMetadata = {
  type: 'number',
  name: 'fiscal_year',
  // @ts-expect-error — objectui#11026 declared `useGrouping` as the spec's boolean; a string is not a hint
  useGrouping: 'false',
};

describe('objectui#11026 — the installed spec declares the key this face mirrors', () => {
  it('FieldSchema keeps an authored boolean useGrouping on a number field', () => {
    for (const useGrouping of [true, false]) {
      const parsed = FieldSchema.safeParse({ name: 'fiscal_year', type: 'number', scale: 0, useGrouping });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(parsed.data?.useGrouping).toBe(useGrouping);
    }
  });

  it('FieldSchema refuses a non-boolean useGrouping', () => {
    const parsed = FieldSchema.safeParse({ name: 'fiscal_year', type: 'number', useGrouping: 'false' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toContain('useGrouping');
  });
});
