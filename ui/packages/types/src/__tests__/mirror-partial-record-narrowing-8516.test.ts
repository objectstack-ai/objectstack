/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8516 + objectui#8556 — two mirrors keyed by their own declaration's
 * vocabulary instead of by `string`.
 *
 * ## The class, and why it is one card's worth of repair twice
 *
 * A mirror restates a TS declaration by hand. Both keys below restated a CLOSED
 * key set as an OPEN one, so the validator that judges authored JSON accepted a
 * spelling the published types refuse:
 *
 * | key | mirror was | declaration |
 * | :-- | :--------- | :---------- |
 * | `GridSchema.columns` | `z.record(z.string(), z.number())` | `number` OR a partial breakpoint map |
 * | `ReportComponentSchema.exportConfigs` | `z.record(z.string(), ReportExportConfigSchema)` | a partial per-format map |
 *
 * `@object-ui/cli`'s `validate` / `check` are the real consumers of these
 * mirrors, so on the primary authoring surface of a server-driven-UI product a
 * grid keyed `{ xxl: 6 }` passed validation and then rendered at its default
 * column count with no error and no warning — objectui#7097's defect surviving
 * on the face objectui#8505 did not touch.
 *
 * ## ⛔ The spelling that looks right and is not
 *
 * `z.record(z.enum([…]), …)` — MEASURED on zod 4.4.3, the version this package
 * depends on, and re-measured here as an executable pin rather than quoted:
 *
 * ```
 * z.record(z.enum(SIX), z.number()).safeParse({ md: 2 })
 *   -> success: false, five `invalid_type` issues, one per ABSENT member
 * ```
 *
 * zod 4's plain `z.record` over an enum key REQUIRES every member. So that
 * spelling refuses the partial map both declarations explicitly invite — it
 * clears the `WiderThanDeclared` reading and produces the opposite divergence
 * on the same pair. `z.partialRecord` is the spelling that does not.
 *
 * The pins that catch the overshoot are `_columnsFace` / `_columnsIsPartial` and
 * `_exportConfigsIsPartial` below (compile time — each compares a WHOLE map type,
 * ⛔ never a `keyof`, which erases the optionality that IS the overshoot) and the
 * accepting rows in each `describe` (run time), plus the ledger reconciliation in the sibling
 * `zod-mirror-parity.test.ts`, which is the file-level instrument objectui#8556
 * ruled this must be pinned against rather than against an accept set alone.
 *
 * ## Which program checks the type-level half
 *
 * `packages/types`' `type-check` runs THREE programs and this file is in the
 * third, `tsconfig.test.json` — `tsc --noEmit` builds `tsconfig.json`, which
 * excludes `__tests__/` by directory, so it reads none of the `Eq` constants
 * below and is a FALSE GREEN for them. Confirmed with `--listFiles`, not
 * assumed (the same trap `grid-columns-breakpoint-narrowing-8505.test.ts`
 * records, and objectui#8342 before it).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { GridSchema } from '../layout';
import type { BreakpointName } from '../mobile';
import type { ReportExportFormat, ReportComponentSchema } from '../reports';
import { GridSchema as GridZodMirror } from '../zod/layout.zod';
import { ReportComponentSchema as ReportZodMirror } from '../zod/reports.zod';

/** Mutual assignability, the standard invariant `Eq` — not `extends`. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;

const SIX = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;

/* ── (a) the two mirror faces, pinned against their declarations ──────────── */

type MirrorColumns = z.input<typeof GridZodMirror.shape.columns>;
type MirrorColumnMap = NonNullable<Exclude<MirrorColumns, number>>;
type MirrorExportConfigs = NonNullable<z.input<typeof ReportZodMirror.shape.exportConfigs>>;

describe('objectui#8516 — the grid mirror states the declaration, at compile time', () => {
  it('the mirror`s INPUT face equals the declared member, both directions', () => {
    // The reconciliation `zod-mirror-parity.test.ts` performs over every
    // registered pair, restated locally for the one key this card repaired.
    // Invariant, so it fails on a widening back to `Record<string, number>` AND
    // on a narrowing past the declaration.
    const _columnsFace: Eq<MirrorColumns, GridSchema['columns']> = true;
    expect(_columnsFace).toBe(true);
  });

  it('the map arm is keyed by the breakpoint vocabulary, not by string', () => {
    // The six names are spelled by hand in `layout.zod.ts` because `mobile.ts`
    // has no zod mirror to derive them from. THIS is the derivation: drop a
    // breakpoint from either face, or add a seventh, and it stops compiling.
    const _columnKeys: Eq<keyof MirrorColumnMap, BreakpointName> = true;
    expect(_columnKeys).toBe(true);
  });

  it('the map arm is PARTIAL, not total — the zod-4 overshoot, at compile time', () => {
    // `z.record(z.enum(SIX), z.number())` infers the TOTAL `Record`, so this
    // constant is the compile-time half of the overshoot guard: it reddens on
    // the forbidden spelling without anyone having to run a parse.
    // The values are the counts the renderer maps since objectui#11491; this
    // row's subject is the map's partiality and its keys.
    const _columnsIsPartial: Eq<
      MirrorColumnMap,
      Partial<Record<BreakpointName, 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12>>
    > = true;
    expect(_columnsIsPartial).toBe(true);
  });
});

describe('objectui#8556 — the report mirror states the declaration, at compile time', () => {
  it('the map is keyed by ReportExportFormat, not by string', () => {
    const _exportKeys: Eq<keyof MirrorExportConfigs, ReportExportFormat> = true;
    expect(_exportKeys).toBe(true);
  });

  it('the map is PARTIAL, not total — objectui#6121`s ruling, held on the mirror', () => {
    // objectui#6121's maintainer ruling removed the TOTAL `Record` from the
    // TypeScript face because it made configuring ONE format an error. The
    // forbidden `z.record(z.enum([…]), …)` spelling would re-impose exactly
    // that on the mirror, one authoring face over.
    //
    // ⚠️ This pin was FIRST WRITTEN AS `Eq[keyof MirrorExportConfigs, keyof
    // Partial[Record[ReportExportFormat, unknown]]]` and that spelling was INERT
    // against the very overshoot this row is named for: `keyof` erases
    // optionality, so `keyof Record[F, V]` and `keyof Partial[Record[F, V]]` are
    // the same type and the constant stayed `true` under the forbidden spelling.
    // Measured, not reasoned: under ablation B it did not appear among the
    // compile errors, while its grid counterpart `_columnsIsPartial` — which
    // compares the WHOLE map type — did. A pin that cannot fail is worse than no
    // pin, because it is counted as coverage. ⛔ Do not reintroduce a `keyof`
    // comparison here; compare the map to its own `Partial`, which is a fixed
    // point only when the map is already partial.
    const _exportConfigsIsPartial: Eq<MirrorExportConfigs, Partial<MirrorExportConfigs>> = true;
    expect(_exportConfigsIsPartial).toBe(true);
  });

  it('the declaration this mirror restates is itself partial', () => {
    const _declared: Eq<
      NonNullable<ReportComponentSchema['exportConfigs']>,
      Partial<Record<ReportExportFormat, NonNullable<ReportComponentSchema['exportConfigs']>[ReportExportFormat]>>
    > = true;
    expect(_declared).toBe(true);
  });
});

/* ── (b) the accept set, at run time ──────────────────────────────────────── */

describe('objectui#8516 — GridSchema.columns accept set', () => {
  it('accepts the bare number arm', () => {
    expect(GridZodMirror.safeParse({ type: 'grid', columns: 3 }).success).toBe(true);
  });

  it.each(SIX)('accepts a one-key map for `%s`', (bp) => {
    // ⭐ The overshoot guard at run time, one row per member: under
    // `z.record(z.enum(SIX), …)` every one of these six rows fails, because
    // each names ONE key and zod 4 then demands all six.
    expect(GridZodMirror.safeParse({ type: 'grid', columns: { [bp]: 2 } }).success).toBe(true);
  });

  it('accepts the full six-key map, and the empty map', () => {
    const full = Object.fromEntries(SIX.map((k, i) => [k, i + 1]));
    expect(GridZodMirror.safeParse({ type: 'grid', columns: full }).success).toBe(true);
    expect(GridZodMirror.safeParse({ type: 'grid', columns: {} }).success).toBe(true);
  });

  it.each(['xxl', 'XL', '2XL', 'mobile'])('refuses the out-of-vocabulary key `%s`', (bad) => {
    // `xxl` is not an arbitrary bad key: it is the Bootstrap/Ant spelling, the
    // one an author reaches for first, and the renderer silently ignores it.
    expect(GridZodMirror.safeParse({ type: 'grid', columns: { [bad]: 6 } }).success).toBe(false);
  });

  it('names the offending key in the issue an author is shown', () => {
    // Q1, measured rather than assumed. `columns` is a UNION (a number, or the
    // `z.partialRecord`). Under zod 4.4 zod reported one top-level
    // `invalid_union` whose message was the bare "Invalid input", and the key
    // surfaced only inside its arms, as an `invalid_key` whose PATH held it.
    // Since zod 4.6 (objectui#11073, forced by `@objectstack/spec` 17.5.0's
    // `zod ^4.6.1`) a record's out-of-vocabulary key is a NON-aborting
    // `unrecognized_keys`, the number arm is the only aborted one, and the union
    // returns the record arm's issue on its own: `unrecognized_keys` AT
    // `columns`, naming the key in `keys` and in its message. Still named, and
    // named at the top level now; this pins which.
    const r = GridZodMirror.safeParse({ type: 'grid', columns: { xxl: 6 } });
    expect(r.success).toBe(false);
    expect(r.error!.issues).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', path: ['columns'], keys: ['xxl'] }),
    ]);
    expect(r.error!.issues[0].message).toContain('xxl');
  });
});

describe('objectui#8556 — ReportComponentSchema.exportConfigs accept set', () => {
  const base = { type: 'report' as const };

  it.each(['pdf', 'excel', 'csv', 'json', 'html'])('accepts a one-format map for `%s`', (fmt) => {
    // The same per-member overshoot guard as the grid rows above.
    const doc = { ...base, exportConfigs: { [fmt]: { format: fmt } } };
    expect(ReportZodMirror.safeParse(doc).success).toBe(true);
  });

  it('accepts the empty map', () => {
    expect(ReportZodMirror.safeParse({ ...base, exportConfigs: {} }).success).toBe(true);
  });

  it('refuses a key outside ReportExportFormat', () => {
    // The exact document objectui#8556 measured as parsing green.
    const doc = { ...base, exportConfigs: { xml: { format: 'pdf' } } };
    expect(ReportZodMirror.safeParse(doc).success).toBe(false);
  });

  it('CONTROL — the mirror still judges the VALUE, not only the key', () => {
    // Without this, every refusal above would read the same against a mirror
    // that refuses everything.
    const doc = { ...base, exportConfigs: { pdf: { format: 'xml' } } };
    expect(ReportZodMirror.safeParse(doc).success).toBe(false);
  });
});

/* ── (c) the zod-4 semantics the repair turns on, pinned executably ───────── */

describe('objectui#8516 — why `z.record(z.enum([…]), …)` is the wrong spelling', () => {
  it('the plain record over an enum key REQUIRES every member', () => {
    // The measurement both cards carry, executable so it cannot rot into
    // folklore: if a future zod makes this spelling partial, this row fails and
    // the prose above is re-read rather than trusted.
    const forbidden = z.record(z.enum(SIX), z.number());
    const r = forbidden.safeParse({ md: 2 });
    expect(r.success).toBe(false);
    expect(r.error!.issues.filter((i) => i.code === 'invalid_type')).toHaveLength(5);
  });

  it('…while `z.partialRecord` over the same key accepts it', () => {
    const chosen = z.partialRecord(z.enum(SIX), z.number());
    expect(chosen.safeParse({ md: 2 }).success).toBe(true);
    expect(chosen.safeParse({ xxl: 6 }).success).toBe(false);
  });
});
