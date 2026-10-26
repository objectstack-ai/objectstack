// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `exportOptions` is the spec's object form, and only that (objectui#4535).
 *
 * The card behind this file: `ObjectGridSchema.exportOptions` carried four keys
 * under a comment claiming alignment with `@objectstack/spec`'s
 * `ListViewSchema.exportOptions`, which at the time was a bare format ARRAY —
 * so the comment was false in both directions, and the `streaming` key the
 * renderer honoured appeared in no declaration at all. objectstack#8010 closed
 * that upstream by declaring `ListViewExportOptionsSchema` with exactly the five
 * keys the renderer reads; this file pins the local half to those five.
 *
 * The assertions are mostly type-level on purpose. `keyof` comparisons run in
 * `tsc -p tsconfig.test.json` (part of this package's `type-check`), so a sixth
 * key added to the interface fails the build rather than waiting for a reviewer
 * to notice — which is the failure mode objectstack#8010 was reported for.
 */

import { describe, it, expect } from 'vitest';
import type { ListViewExportFormat, ListViewExportOptions, NamedListView, ObjectGridSchema } from '../index';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── The key set is the spec's five ──────────────────────────────────────── */

/**
 * `ListViewExportOptionsSchema` in `@objectstack/spec` 17.0.0
 * (objectstack#8010 / objectstack#8324) declares exactly these. Adding a key
 * here to make a new local read compile is the defect, not the fix: the key has
 * to exist in the spec first, or the platform refuses metadata that declares it.
 */
type SpecDeclaredKeys = 'formats' | 'maxRecords' | 'includeHeaders' | 'fileNamePrefix' | 'streaming';

type _KeysAreExactlyTheSpecFive = Expect< Equal< keyof ListViewExportOptions, SpecDeclaredKeys > >;

/** The grid's `exportOptions` IS that type — not a lookalike that can drift. */
type _GridUsesTheSharedType = Expect<
  Equal< NonNullable< ObjectGridSchema['exportOptions'] >, ListViewExportOptions >
>;

/** So does a saved named view, so one authoring surface cannot outgrow the other. */
type _NamedViewUsesTheSharedType = Expect<
  Equal< NonNullable< NamedListView['exportOptions'] >, ListViewExportOptions >
>;

/* ── `'pdf'` is retired ──────────────────────────────────────────────────── */

/**
 * The surviving formats. PDF export was declined platform-side
 * (objectstack#1301 NOT_PLANNED) and the value left the spec enum in 17.0.0
 * (objectstack#8010), where declaring it is now a parse-time refusal carrying
 * `os migrate meta --from 16`.
 */
type _FormatsAreCsvXlsxJson = Expect< Equal< ListViewExportFormat, 'csv' | 'xlsx' | 'json' > >;

describe('exportOptions — the spec object form (objectui#4535)', () => {
  it('accepts the five spec keys', () => {
    const options: ListViewExportOptions = {
      formats: ['csv', 'xlsx', 'json'],
      maxRecords: 5000,
      includeHeaders: false,
      fileNamePrefix: 'contracts',
      streaming: false,
    };
    // Runtime half: the type-level assertions above are erased, so without a
    // value that actually carries all five keys, a rename would still compile.
    expect(Object.keys(options).sort()).toEqual(
      ['fileNamePrefix', 'formats', 'includeHeaders', 'maxRecords', 'streaming'],
    );
  });

  it('refuses a retired `pdf` format', () => {
    const options: ListViewExportOptions = {
      // @ts-expect-error 'pdf' left the spec's format enum in @objectstack/spec
      // 17.0.0 (objectstack#8010; PDF export declined as objectstack#1301
      // NOT_PLANNED). Restoring it to the union makes this directive unused and
      // reds the type-check — which is the point: the value must not come back
      // locally while the platform refuses it at publish.
      formats: ['csv', 'pdf'],
    };
    expect(options.formats).toEqual(['csv', 'pdf']);
  });

  it('refuses a key the spec does not declare', () => {
    const options: ListViewExportOptions = {
      // @ts-expect-error A sixth key is capability surface with no reader and no
      // authoring surface — objectstack#8010 was filed for exactly that shape.
      compression: 'gzip',
    };
    expect(options).toBeDefined();
  });
});
