/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Sub-schema ↔ @objectstack/spec drift guard (issue #2231, phase 2).
 *
 * The former hand-written mirrors in `zod/objectql.zod.ts` are now the spec's
 * schemas **by reference** — re-forking one (replacing the re-export with a
 * local copy that can drift) is exactly the failure mode that produced the
 * original ListViewSchema divergence. (`zod/theme.zod.ts` carried six such
 * re-exports too until the spec retired its whole theme module — see the
 * retirement block below.) These tests pin:
 *
 *   1. Identity for every direct re-export — `toBe`, not structural equality,
 *      so a "faithful copy" fails too: a copy is a fork. ⭐ Since objectui#8317
 *      (decision batch #90) the subject of that identity is the spec object AS
 *      IT ENTERS THIS PACKAGE — `stripImportedDefaults(spec)` — not the raw
 *      spec object. That call is the whole of the sanctioned difference: it
 *      removes the imported `ZodDefault`s so this validator stops writing
 *      values into an author's document, and changes nothing else. A subtree
 *      with no default to strip comes back REFERENCE-EQUAL to the spec's own
 *      object, and three pairs below are exactly that, which is what keeps this
 *      assertion from degrading into "equals whatever the boundary produced".
 *   2. The one *derived* schema (`ListColumnSchema`): every spec field flows in,
 *      the local-extension set is exactly the sanctioned one, and the `summary`
 *      broadening keeps the spec enum as its first (by-reference) union arm.
 *
 * When one of these fails, do NOT fork the schema back to make it green — the
 * schema belongs upstream in `@objectstack/spec`. Extend locally via `.extend()`
 * on the spec base (and sanction the field here) only for genuinely
 * objectui-only renderer concerns. See #2231.
 */
import { describe, it, expect } from 'vitest';
import {
  HttpMethodSubsetSchema as SpecHttpMethodSubsetSchema,
  HttpRequestSchema as SpecHttpRequestSchema,
  ViewDataSchema as SpecViewDataSchema,
  ListColumnSchema as SpecListColumnSchema,
  ColumnSummarySchema as SpecColumnSummarySchema,
  SelectionConfigSchema as SpecSelectionConfigSchema,
  PaginationConfigSchema as SpecPaginationConfigSchema,
  ChartTypeSchema as SpecChartTypeSchema,
  PageTypeSchema as SpecPageTypeSchema,
} from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import {
  HttpMethodSchema,
  HttpRequestSchema,
  ViewDataSchema,
  ListColumnSchema,
  SelectionConfigSchema,
  PaginationConfigSchema,
} from '../zod/objectql.zod.js';
import { ChartTypeSchema } from '../zod/data-display.zod.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';
import { PageTypeSchema } from '../zod/layout.zod.js';

describe('spec sub-schema re-exports are the spec objects (by reference)', () => {
  const pairs: Array<[string, unknown, unknown]> = [
    // The spec renamed the 5-value subset to `HttpMethodSubsetSchema` in
    // 17.0.0-rc.5 (objectstack#5832) so it stops colliding with the 7-value
    // `HttpMethod` in the published JSON Schema. This repo still exports it as
    // `HttpMethodSchema`; the pin is what proves the two are still the SAME
    // object, i.e. that following the rename did not quietly widen the type to
    // the 7-value enum (objectui#3499).
    ['HttpMethodSchema', HttpMethodSchema, SpecHttpMethodSubsetSchema],
    ['HttpRequestSchema', HttpRequestSchema, SpecHttpRequestSchema],
    ['ViewDataSchema', ViewDataSchema, SpecViewDataSchema],
    ['SelectionConfigSchema', SelectionConfigSchema, SpecSelectionConfigSchema],
    ['PaginationConfigSchema', PaginationConfigSchema, SpecPaginationConfigSchema],
    // The six THEME pairs (`ColorPaletteSchema`, `TypographySchema`,
    // `BorderRadiusSchema`, `ShadowSchema`, `ThemeModeSchema`,
    // `ThemeDefinitionSchema`↔`ThemeSchema`) REMOVED, not re-pointed — the
    // same shape as the earlier `AnimationSchema` / `ZIndexSchema` removal
    // (objectstack#5021, PR objectstack#5289): objectstack#10485 (ADR-0049,
    // PR objectstack#10695) retired the spec's whole `ui/theme.zod.ts`
    // module, and the objectstack#10856 ruling had objectui remove its
    // re-exports (objectui#5710). There is no longer a pair to compare on
    // either side; the describe block at the bottom pins the names OUT of
    // `zod/theme.zod.ts` instead.
    // #2944 — these two were forks that had already drifted, re-exported under
    // the spec's own symbol name so an importer could not tell them apart.
    // `ChartTypeSchema` carried 7 of the spec's 19 values and is why #2901 was
    // filed against the wrong side of the contract; `PageTypeSchema` was missing
    // `list`. Pinned by reference so neither can be re-forked silently.
    ['ChartTypeSchema', ChartTypeSchema, SpecChartTypeSchema],
    ['PageTypeSchema', PageTypeSchema, SpecPageTypeSchema],
  ];

  it.each(pairs.map(([name]) => [name] as const))('%s', (name) => {
    const [, oui, spec] = pairs.find(([n]) => n === name)!;
    expect(
      oui,
      `${name} must be the spec schema as it enters this package — ` +
        '`stripImportedDefaults(<spec schema>)` and nothing else. A local copy is a fork ' +
        '(#2231); a copy with any OTHER edit is the same fork wearing the boundary\'s name.',
    ).toBe(stripImportedDefaults(spec as never));
  });

  /**
   * ⭐ The control that keeps the assertion above from being vacuous.
   *
   * `stripImportedDefaults` is the identity function on a subtree with nothing
   * to strip (see its walker's identity property), so for a schema that carries
   * no `ZodDefault` the assertion above degenerates into `toBe(spec)` — the
   * pre-objectui#8317 pin, unchanged and still load-bearing. These four are
   * that case, asserted directly so it is a MEASUREMENT rather than a claim in
   * a docblock: if the boundary ever started cloning unconditionally, this goes
   * red and the pin above would not.
   */
  it.each([
    ['HttpMethodSchema', HttpMethodSchema, SpecHttpMethodSubsetSchema],
    ['ChartTypeSchema', ChartTypeSchema, SpecChartTypeSchema],
    ['PageTypeSchema', PageTypeSchema, SpecPageTypeSchema],
    // Since @objectstack/spec 18.0.0-next.1 retired the view-level `api`
    // provider (objectstack#23160), whose request block carried the defaults,
    // `ViewDataSchema` has nothing to strip either (objectui#12370).
    ['ViewDataSchema', ViewDataSchema, SpecViewDataSchema],
  ] as const)('%s carries no imported default, so it is still the raw spec object', (name, oui, spec) => {
    expect(oui, `${name} has nothing to strip and must stay reference-equal to the spec object`).toBe(spec);
  });

  /**
   * …and the other half of the same control: the three that DO carry an
   * imported default are NOT the raw spec object any more. That is the
   * behaviour change objectui#8317 shipped, pinned so it cannot be undone by
   * quietly reverting the boundary — and so a reader who lands on the
   * `toBe(stripImportedDefaults(...))` line above can see that the call is
   * doing something.
   */
  it.each([
    ['HttpRequestSchema', HttpRequestSchema, SpecHttpRequestSchema],
    ['SelectionConfigSchema', SelectionConfigSchema, SpecSelectionConfigSchema],
    ['PaginationConfigSchema', PaginationConfigSchema, SpecPaginationConfigSchema],
  ] as const)('%s carried an imported default, so it is the boundary derivation', (name, oui, spec) => {
    expect(oui, `${name} still IS the raw spec object — the import boundary was bypassed`).not.toBe(spec);
    expect(oui).toBe(stripImportedDefaults(spec as never));
  });
});

/**
 * The retired theme schemas stay retired. Two waves of the same shape:
 * spec v17 (#3494) pruned the never-enforced Theme keys and their sub-schema
 * re-exports left with it (`SpacingSchema` and friends); then
 * objectstack#10485 (ADR-0049, PR objectstack#10695) retired the spec's whole
 * `ui/theme.zod.ts` module, and the maintainer's ruling on objectstack#10856
 * had objectui REMOVE its six re-exports rather than localize them
 * (objectui#5710) — an objectui-only mirror would be the second de-facto
 * contract AGENTS.md #0.1 forbids, one repo over from the compatibility
 * surface (Option B) that ruling explicitly declined. The per-key
 * `SpecThemeSchema.shape` assertions this block used to carry left with the
 * spec schema itself — there is no upstream shape left to read.
 *
 * If a later ruling (e.g. on objectui#5647's theme component kinds) decides
 * to localize a theme document schema DELIBERATELY, update this list in the
 * PR that records that ruling.
 */
describe('retired theme schemas stay retired (#3494, objectstack#10485 / objectui#5710)', () => {
  it('objectui does not re-add a local mirror of a retired theme schema', async () => {
    const themeZod = await import('../zod/theme.zod.js');
    for (const name of [
      // spec v17 pruning (#3494)
      'SpacingSchema',
      'SpacingScaleSchema',
      'BreakpointsSchema',
      'ThemeLogoSchema',
      // whole-module retirement (objectstack#10485, removal executed as objectui#5710)
      'ColorPaletteSchema',
      'TypographySchema',
      'BorderRadiusSchema',
      'ShadowSchema',
      'ThemeModeSchema',
      'ThemeDefinitionSchema',
      'ThemeSchema',
    ]) {
      expect(
        name in themeZod,
        `'${name}' is gone from @objectstack/spec/ui — do not reintroduce it as an ` +
          `objectui-local schema without a maintainer ruling (objectui#5710)`,
      ).toBe(false);
    }
  });
});

/**
 * spec v17 promoted objectui's last two local ListColumn extensions upstream
 * (objectui#2231), so the `.extend()` collapsed into a plain re-export. These
 * assertions now guard that collapse: the schema stays the spec object itself,
 * and the `summary` / `prefix` shapes the grid renderer depends on keep working
 * through it.
 */
describe('ListColumnSchema is the spec schema (the extension collapsed)', () => {
  const specShape = (SpecListColumnSchema as unknown as { shape: Record<string, unknown> }).shape;
  const ouiShape = (ListColumnSchema as unknown as { shape: Record<string, unknown> }).shape;

  it('is the spec schema itself, not a copy or an extension', () => {
    expect(
      ListColumnSchema,
      'ListColumnSchema must be SpecListColumnSchema as it enters this package — if a local ' +
        'field is needed again, promote it into @objectstack/spec instead of re-extending here. ' +
        'The `stripImportedDefaults` hop is objectui#8317 and is the only sanctioned difference.',
    ).toBe(stripImportedDefaults(SpecListColumnSchema));
  });

  it('carries no objectui-only fields', () => {
    const localOnly = Object.keys(ouiShape).filter((k) => !(k in specShape));
    expect(localOnly.sort()).toEqual([]);
  });

  it('summary keeps the spec enum as its by-reference base arm', () => {
    // ZodOptional<ZodUnion<[SpecColumnSummarySchema, ZodObject]>>
    const summary = ouiShape.summary as { unwrap(): { def: { options: unknown[] } } };
    const arms = summary.unwrap().def.options;
    expect(arms[0], 'summary union arm 0 must be the spec ColumnSummarySchema by reference').toBe(
      SpecColumnSummarySchema,
    );
  });

  it('the object arm accepts exactly the same aggregation vocabulary', () => {
    // Both arms must accept the same vocabulary: a name valid as the string
    // shorthand but rejected in the `{ type, field }` form (or vice versa)
    // means the per-column `field` override is unavailable for that
    // aggregation for no reason the author can see.
    //
    // Asserted behaviorally rather than by identity: the spec builds the object
    // arm through `lazySchema`, whose Proxy resolves `.shape.type` to the inner
    // enum instead of the exported schema object, so a `toBe` check would test
    // the wrapper rather than the vocabulary it is meant to protect.
    // The wrapper walk is `@object-ui/test-support`'s shared reader
    // (objectui#6924). No throw wrapper: the assertion on the next line already
    // discharges the reader's non-vacuity duty, which is what keeps the loop
    // below from passing over an empty vocabulary now that a failed read
    // answers `[]` instead of throwing (objectui#7025).
    const vocabulary = enumOptions(SpecColumnSummarySchema);
    expect(vocabulary.length, 'spec ColumnSummarySchema should be a non-empty enum').toBeGreaterThan(0);

    for (const agg of vocabulary) {
      expect(
        ListColumnSchema.shape.summary.safeParse(agg).success,
        `summary shorthand "${agg}" must parse`,
      ).toBe(true);
      expect(
        ListColumnSchema.shape.summary.safeParse({ type: agg, field: 'amount' }).success,
        `summary object form { type: "${agg}" } must parse — both arms share one vocabulary`,
      ).toBe(true);
    }

    // …and neither arm accepts a name outside it.
    expect(ListColumnSchema.shape.summary.safeParse('median').success).toBe(false);
    expect(ListColumnSchema.shape.summary.safeParse({ type: 'median' }).success).toBe(false);
  });

  it('summary accepts every spec aggregation and the renderer object form', () => {
    for (const agg of ['none', 'count', 'count_unique', 'percent_filled', 'sum', 'avg', 'min', 'max']) {
      expect(ListColumnSchema.shape.summary.safeParse(agg).success, `summary "${agg}"`).toBe(true);
    }
    expect(ListColumnSchema.shape.summary.safeParse({ type: 'sum', field: 'amount' }).success).toBe(true);
    // The old mirror's free-string arm is gone — unknown aggregations fail loudly.
    expect(ListColumnSchema.shape.summary.safeParse('median').success).toBe(false);
  });

  it('prefix parses the compound-cell form and no longer WRITES `type` for the author', () => {
    // ⭐ INVERTED by objectui#8317 (decision batch #90). spec v17 made `type` a
    // `ZodDefault`, and this pin used to assert the substitution: an author who
    // wrote `{ field: 'status' }` got back `{ field: 'status', type: 'text' }`.
    // That is precisely the "one authored document, two shapes" defect
    // objectui#7735 was opened about, arriving through an imported subschema,
    // and batch #90 ruled it out for imported keys as well as local ones. The
    // author's document comes back as the author wrote it.
    //
    // ⛔ Not an accept-set change: the key stays omissible (that is what the
    // boundary's re-optionalisation is for) and the value vocabulary is
    // untouched — the two probes below are unchanged from the pre-#8317 pin.
    // ⚠️ ObjectGrid's cell renderer is where the `'text'` fallback belongs, and
    // batch #69 already ruled that the renderer's fallback is THE authoritative
    // default; the mirror describing it is not the mirror writing it.
    expect(ListColumnSchema.shape.prefix.parse({ field: 'status' })).toEqual({ field: 'status' });
    // …and a document that DOES write it round-trips unchanged.
    expect(ListColumnSchema.shape.prefix.parse({ field: 'status', type: 'text' }))
      .toEqual({ field: 'status', type: 'text' });
    expect(ListColumnSchema.shape.prefix.safeParse({ field: 'status', type: 'badge' }).success).toBe(true);
    expect(ListColumnSchema.shape.prefix.safeParse({ field: 'status', type: 'pill' }).success).toBe(false);
  });
});
