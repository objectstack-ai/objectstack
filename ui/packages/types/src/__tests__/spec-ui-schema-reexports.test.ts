/**
 * Guardrail for #2561 — decision (a): the zod validators (`…Schema`) of
 * `@objectstack/spec/ui` are NOT part of @object-ui/types' public surface.
 *
 * Background: index.ts re-exports the spec UI surface inside
 * `export type { … }` blocks. A zod schema listed in such a block is
 * value-erased — a consumer importing it as a value silently got `undefined`
 * at runtime. Decision (a) drops those names instead of converting them to
 * value re-exports; consumers needing the runtime validators import
 * `@objectstack/spec/ui` directly.
 *
 * Note: dual type+value names (`Dashboard`, `ThemeMode`, …) are intentionally
 * re-exported type-only — only `…Schema`-suffixed zod values are governed by
 * this contract. (`DensityMode` used to head that list; objectstack#3494 /
 * PR objectstack#3516 retired it from the spec, so it is no longer an example
 * of anything — same rot the ratchet below now catches for the deny-list.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// This re-export parity guard walks the WHOLE spec/ui surface — the namespace
// import is its instrument, a sanctioned importer (#3090 tripwire).
// eslint-disable-next-line no-restricted-imports
import * as SpecUI from '@objectstack/spec/ui';
import * as Types from '../index';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The public names dropped in #2561 (previously value-erased `export type`
 * re-exports of spec/ui zod schemas, listed under their exported alias).
 *
 * Every entry must still be a live `@objectstack/spec/ui` export — the ratchet
 * below enforces it. A row for a name the spec has retired guards nothing
 * (nothing can re-export a name upstream no longer publishes), so it must be
 * deleted rather than left to dilute the real guards (#3601).
 */
const DROPPED_SCHEMA_EXPORTS = [
  // Notifications
  // `NotificationActionSchema` removed (objectui#3362 residue, closed out on
  // objectui#3363): objectstack#5015 / PR objectstack#5300 RETIRED
  // `NotificationAction` from the spec outright. A deny-list entry for a name
  // the spec no longer publishes asserts nothing about this package's decision
  // — nothing could re-export it — so the row passed as a tautology.
  'NotificationPositionSchema',
  'NotificationSeveritySchema',
  'NotificationTypeSchema',
  // View Enhancements
  'ColumnSummarySchema',
  'GalleryConfigSchema',
  'GroupingConfigSchema',
  'RowColorConfigSchema',
  'RowHeightSchema',
  'TimelineConfigSchema',
  'NavigationConfigSchema',
  'ViewSharingSchema',
  // Dashboard
  'SpecDashboardSchema',
  'SpecDashboardWidgetSchema',
  'SpecDashboardHeaderSchema',
  'SpecDashboardHeaderActionSchema',
  'SpecGlobalFilterSchema',
  'GlobalFilterOptionsFromSchema',
  'WidgetColorVariantSchema',
  // Sharing & Embedding
  'SharingConfigSchema',
  // `EmbedConfigSchema` removed for the same reason as
  // `NotificationActionSchema` above — `EmbedConfig` was retired by
  // objectstack#5015 / PR objectstack#5300.
  // View Configuration
  'AddRecordConfigSchema',
  'AppearanceConfigSchema',
  'UserActionsConfigSchema',
  'ViewTabSchema',
  // View Filter Rules
  'ViewFilterRuleSchema',
  // Form View
  'SpecFormViewSchema',
  'SpecFormSectionSchema',
  'SpecFormFieldSchema',
  // ListView
  'SpecListViewSchema',
  'SpecListColumnSchema',
  // Page
  'SpecPageSchema',
  'SpecPageComponentSchema',
  'SpecPageRegionSchema',
  'SpecPageTypeSchema',
  'SpecPageVariableSchema',
  // Accessibility
  'AriaPropsSchema',
  // I18n
  'I18nLabelSchema',
  // `I18nObjectSchema`, `LocaleConfigSchema`, `PluralRuleSchema`,
  // `DateFormatSchema` and `NumberFormatSchema` were removed from this list on
  // the @objectstack/spec 17.0.0-rc.6 bump (objectstack#7100): the spec RETIRED
  // all five, so each row asserted "this name is not re-exported from
  // @object-ui/types" about a name that no longer exists anywhere — vacuously
  // true forever, which is what the guard above this list exists to catch.
  // `I18nLabelSchema` SURVIVES rc.6 and stays denied; the release folded the
  // per-locale record form into `I18nLabel` itself (`string` →
  // `string | Record<string, string>`) and ships `resolveI18nLabel` for it.
  // Responsive Design
  // The three responsive rows — `SpecResponsiveConfigSchema`,
  // `BreakpointColumnMapSchema` and `BreakpointOrderMapSchema` — were removed
  // by objectui#7580, ahead of the ratchet below firing, on the same reading
  // that took the `ThemeModeSchema` row out at objectui#5716. objectstack#11027
  // retired the spec's whole `ui/responsive` vocabulary, and this repo no
  // longer re-exports ANY of it: `BreakpointName` is declared locally in
  // `../mobile.ts` and `BreakpointColumnMap` in `@object-ui/layout`, while the
  // prefixed `SpecResponsiveConfig` pair was dropped from `../index.ts` as a
  // dead re-export once its two readers went. So each row was about to assert
  // that a name is not re-exported from this package while the name itself no
  // longer exists anywhere — vacuously true forever, which is precisely what
  // the ratchet above this list exists to catch.
  // The `ThemeModeSchema` row (theme.ts) was removed by objectui#5716, ahead
  // of the ratchet below firing: the spec retired its whole theme module
  // (objectstack#10485) and the theme TYPE surface is owned by this package
  // now — `theme.ts` no longer re-exports anything from `@objectstack/spec/ui`,
  // so once the pin moves past the retirement the row would have asserted
  // nothing. The mode vocabulary's runtime value is `THEME_MODES` (a local
  // tuple, deliberately exported as a VALUE — the #2561 erasure cannot recur
  // for it).
];

/**
 * Resolves a deny-list entry to the name `@objectstack/spec/ui` actually
 * publishes, or `undefined` if the spec no longer publishes it under any
 * spelling. Entries are listed under their @object-ui/types export alias; the
 * `Spec`-prefixed ones (`SpecPageSchema`) carry that prefix only to dodge a
 * local collision, so the fallback strips it — the same aliasing the list's
 * own doc comment describes.
 */
function resolveSpecName(entry: string): string | undefined {
  const candidates = entry.startsWith('Spec')
    ? [entry, entry.slice('Spec'.length)]
    : [entry];
  return candidates.find((candidate) => candidate in SpecUI);
}

describe('spec/ui …Schema re-exports (#2561, decision (a))', () => {
  // The ratchet (#3601). A deny-list row only asserts something while the spec
  // still publishes the name; once upstream retires it, nothing can re-export
  // it and the row below passes as a tautology. That had already happened to
  // 37 of 82 entries before anyone measured — objectstack#4988 / PR #5321 (32,
  // the five interaction-config modules), #4610 (2), #3494 / PR #3516 (2),
  // #3896 (1) — diluting the 45 rows that do guard something. This makes the
  // next upstream retirement announce itself here instead of waiting for an
  // audit to trip over it.
  //
  // Collected rather than asserted per entry on purpose: retirements land as
  // whole families (32 names in one PR above), and failing on the first would
  // hide the other 31.
  it('every deny-list entry is still a live @objectstack/spec/ui export', () => {
    const retired = DROPPED_SCHEMA_EXPORTS.filter(
      (name) => resolveSpecName(name) === undefined,
    );
    expect(
      retired,
      `@objectstack/spec/ui no longer publishes these DROPPED_SCHEMA_EXPORTS ` +
        `entries: ${retired.join(', ')}. Nothing can re-export a name the spec ` +
        `has retired, so each of these rows asserts nothing — delete it from ` +
        `the list and record the upstream retirement in your PR body`,
    ).toEqual([]);
  });

  it('does not runtime-export the dropped …Schema names', () => {
    for (const name of DROPPED_SCHEMA_EXPORTS) {
      expect(
        name in Types,
        `'${name}' must not be exported from @object-ui/types — #2561 dropped ` +
          `the spec/ui zod-schema re-exports; import it from '@objectstack/spec/ui'`,
      ).toBe(false);
    }
  });

  it('keeps the genuine value re-exports intact', () => {
    expect(typeof Types.defineStack).toBe('function');
    expect(Types.ObjectStackSchema).toBeDefined();
    expect(Types.SpecReportSchema).toBeDefined();
    expect(Types.SpecReportTypeEnum).toBeDefined();
    expect(Types.ACTION_LOCATIONS).toBeDefined();
    expect(Types.ActionLocationSchema).toBeDefined();
  });

  it('source: no spec/ui zod value hides inside an `export type` block', () => {
    for (const file of ['index.ts', 'theme.ts']) {
      const src = readFileSync(join(SRC_DIR, file), 'utf8');
      const blocks = src.matchAll(
        /export type \{([^}]*)\} from '@objectstack\/spec\/ui'/g,
      );
      for (const [, body] of blocks) {
        const sourceNames = mask(body)
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => entry.split(/\s+as\s+/)[0].trim());
        for (const name of sourceNames) {
          const isValueErasedSchema =
            name.endsWith('Schema') &&
            (SpecUI as Record<string, unknown>)[name] !== undefined;
          expect(
            isValueErasedSchema,
            `${file}: '${name}' is a zod value in @objectstack/spec/ui but sits ` +
              `in an 'export type' block, so it would be value-erased (#2561) — ` +
              `drop it or re-export it as a value deliberately`,
          ).toBe(false);
        }
      }
    }
  });
});
