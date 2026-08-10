// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
// ─── [#5055] the widget-registration and locale vocabularies are RETIRED ────
//
// ADR-0049 enforce-or-remove, maintainer ruling 2026-08-06 (window moved from
// protocol 18 to 17 on 2026-08-07): `ui/widget.zod.ts`'s five widget shapes and
// `ui/i18n.zod.ts`'s five doorless shapes are deleted — 10 emitted defs, 20
// exported names — reference docs with them.
//
// The measurement that decided it, re-run on `origin/main` before the removal,
// with its controls passing in the SAME run:
//
//   1. STATIC — nothing under `packages/spec/src` imported `widget.zod` at all
//      (not even the shapes' own siblings), and every live import of `i18n.zod`
//      names `I18nLabelSchema` or `AriaPropsSchema`. So no schema declared a
//      carrier key and no author could write a path that reached these shapes.
//      `field.widget` is a `z.string()` naming a component the RENDERER has
//      registered; it has never referenced `WidgetManifest`.
//   2. GRAPH — a BFS from all 24 metadata-type roots plus `defineStack`'s
//      `ObjectStackSchema` reached none of them, while `PageSchema` /
//      `ObjectListViewSchema` resolved `direct` and a synthetic carrier flipped
//      every one of them (`door-reachability.testkit.ts`).
//   3. CALL SITES — zero `.parse()` / `.safeParse()` in objectstack / objectui /
//      cloud outside these files' own unit tests.
//
// ## Why route 3, and why there is nothing to tombstone
//
// With no carrier key there is no shape on which a `retiredKey()` tombstone
// could sit, and no author document for an ADR-0087 D2 conversion to rewrite.
// That is route 3 of the retirement playbook ("nothing parses it → neither"),
// the shape #4988 used for the ui/ interaction-config family and #4834 for the
// kernel plugin-runtime family. The declared record is the D3
// `SemanticMigration` `ui-widget-i18n-family-retired` plus the
// `RETIRED_DEFS_BY_MAJOR` entries the #4725 manifest-deletion gate reads.
//
// `WidgetManifest.performance`'s own tombstone (#3896) is subsumed rather than
// deleted-in-isolation: it goes with the shape that carried it, which is
// strictly stronger, because there is no longer a manifest to author it INTO.
//
// ## This pin is BIDIRECTIONAL, and the SURVIVAL half carries most of the weight
//
// Absence alone is satisfiable by deleting far too much, and here that is not a
// hypothetical — three of the survivors sit in the two files being emptied:
//
//   - `FieldWidgetPropsSchema` is the NINTH widget site and was deliberately
//     KEPT. It is a React props contract, not authorable metadata; it never
//     appeared in `authorable-surface/` or `json-schema.manifest/`; and objectui
//     PR #3289 (2026-08-03) gave it a live cross-repo compile-time consumer in
//     `packages/fields/src/__tests__/spec-symbol-batch7.test.ts`, which imports
//     the type as an intentional tripwire. A sweep "finishing widget.zod.ts"
//     would take it and break that consumer.
//   - `AriaPropsSchema` is the one REAL door of `i18n.zod.ts` — carried as
//     `aria:` on ~30 live shapes across six metadata-type roots and closed by
//     #4001 批 16. It was measured in the same batch as the five that left.
//   - `I18nLabelSchema` is the label primitive the whole `ui/` tree imports, and
//     it lives in the file five shapes were removed from.
//
// Form follows #4988 / PR #5300: resolved symbol identity over every public
// entry in `package.json`'s exports map. #4642 established that a compile-time
// conditional-type pin in this package was a no-op until #5286 (tsconfig
// excluded `**/*.test.ts`; vitest never enables `typecheck`), so the
// compiler-API walk with anti-vacuity guards is the load-bearing instrument.
describe('[#5055] ui/ widget + i18n family retirement', () => {
  /** The 20 names the ten retired defs exported (10 schema consts + 10 types). */
  const RETIRED_NAMES = [
    // widget.zod.ts — the widget-registration vocabulary
    'WidgetManifest', 'WidgetManifestSchema',
    'WidgetLifecycle', 'WidgetLifecycleSchema',
    'WidgetEvent', 'WidgetEventSchema',
    'WidgetProperty', 'WidgetPropertySchema',
    'WidgetSource', 'WidgetSourceSchema',
    // i18n.zod.ts — the five doorless shapes
    'I18nObject', 'I18nObjectSchema',
    'PluralRule', 'PluralRuleSchema',
    'NumberFormat', 'NumberFormatSchema',
    'DateFormat', 'DateFormatSchema',
    'LocaleConfig', 'LocaleConfigSchema',
  ] as const;

  /** The ADR-0122 parsed aliases that went with them. */
  const RETIRED_PARSED_ALIASES = [
    'WidgetEventParsed',
    'WidgetPropertyParsed',
    'WidgetSourceParsed',
    'WidgetManifestParsed',
    'NumberFormatParsed',
    'LocaleConfigParsed',
  ] as const;

  /**
   * Names that must SURVIVE on `./ui`. The first three are the reason this half
   * exists: all three live in the two files this retirement empties.
   */
  const MUST_SURVIVE = [
    // The ninth widget site — kept, with a live objectui compile-time consumer.
    'FieldWidgetPropsSchema',
    // i18n.zod.ts's real door (批 16) and its label primitive.
    'AriaPropsSchema',
    'I18nLabelSchema',
    // Neighbours a too-wide `ui/` sweep would plausibly take.
    'ResponsiveConfigSchema',
    'NotificationTypeSchema',
    'SharingConfigSchema',
    'ThemeSchema',
    'PageSchema',
    'PageComponentSchema',
  ] as const;

  it('every retired name has ZERO holders on any public entry; the survivors still stand on ./ui', () => {
    // Anti-vacuity: the baseline must cover the real surface. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796. `holdersOf` is now the baseline's query, and
    // `export-origins.test.ts` pins that it discriminates.)
    for (const needed of ['.', './ui', './system', './data', './api']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // Anti-vacuity: `./ui` is a large, real surface — so `not.toContain` on it
    // means something.
    expect(exportNamesOf('./ui').length, './ui must export a non-trivial surface').toBeGreaterThan(100);

    // ── ABSENCE (every entry, not just ./ui) ──────────────────────────────
    for (const name of [...RETIRED_NAMES, ...RETIRED_PARSED_ALIASES]) {
      const holders = holdersOf(name);
      expect(holders, `${name} must have zero holders after #5055`).toEqual([]);
    }

    // ── SURVIVAL (on ./ui, where they live) ───────────────────────────────
    const uiNames = exportNamesOf('./ui');
    for (const name of MUST_SURVIVE) {
      expect(uiNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
    // The surviving widget site's own type aliases, spelled out: ADR-0122 pairs
    // them, and a half-deletion that took the type but left the schema would
    // pass the const check above alone.
    for (const name of ['FieldWidgetProps', 'FieldWidgetPropsParsed']) {
      expect(uiNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('both files survive on disk — this is a SHAPE retirement, not a file deletion', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const uiRoot = path.dirname(fileURLToPath(import.meta.url));

    // Unlike #4988 (five whole files), both files here keep a live occupant, so
    // the existence probe runs in the opposite direction. Anti-vacuity comes
    // from the negative below.
    for (const f of ['widget.zod.ts', 'i18n.zod.ts']) {
      expect(fs.existsSync(path.join(uiRoot, f)), `ui/${f} must NOT be deleted`).toBe(true);
    }
    expect(fs.existsSync(path.join(uiRoot, 'this-file-does-not-exist.zod.ts'))).toBe(false);

    // The retired declarations must be gone from the sources themselves, not
    // merely unexported — an unexported `export const` left behind still emits
    // a def and would show up in the manifest ratchet a release later.
    const widget = fs.readFileSync(path.join(uiRoot, 'widget.zod.ts'), 'utf-8');
    const i18n = fs.readFileSync(path.join(uiRoot, 'i18n.zod.ts'), 'utf-8');
    for (const name of RETIRED_NAMES) {
      expect(widget, `widget.zod.ts must not declare ${name}`).not.toMatch(
        new RegExp(`(?:export )?(?:const|type) ${name}\\b`),
      );
      expect(i18n, `i18n.zod.ts must not declare ${name}`).not.toMatch(
        new RegExp(`(?:export )?(?:const|type) ${name}\\b`),
      );
    }
    // …and the survivors ARE still declared there, so the regex above is not
    // simply failing to match anything.
    expect(widget).toMatch(/export const FieldWidgetPropsSchema\b/);
    expect(i18n).toMatch(/export const AriaPropsSchema\b/);
    expect(i18n).toMatch(/export const I18nLabelSchema\b/);
  });

  it('runtime namespace agrees with the compiler view', async () => {
    const ui = await import('./index');
    for (const name of RETIRED_NAMES) {
      expect(name in ui, `ui must not export ${name}`).toBe(false);
    }
    // Survival at runtime too — the const half of MUST_SURVIVE.
    for (const name of MUST_SURVIVE) {
      expect(name in ui, `${name} must SURVIVE at runtime`).toBe(true);
    }
  });

  it('the surviving `error` slot is exactly the one objectui pinned to (objectui#3289)', async () => {
    // The keep is only defensible while the consumer's assertion holds. objectui
    // asserts `HasKey<FieldWidgetProps, 'error'>` and
    // `Equal<FieldWidgetComponentProps['error'], FieldWidgetProps['error']>`
    // over an OPTIONAL STRING. Pinning the same three facts here means a change
    // that would silently break that repo goes red in this one first.
    const { FieldWidgetPropsSchema } = await import('./widget.zod');
    const shape = (FieldWidgetPropsSchema as never as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape), 'the slot objectui renamed onto').toContain('error');
    expect(Object.keys(shape), 'the old name must not come back as an alias').not.toContain('errorMessage');
    expect(FieldWidgetPropsSchema.safeParse({
      value: 'x', onChange: () => {}, field: { name: 'f', type: 'text' }, error: 'required',
    }).success).toBe(true);
    // Optional: a valid field carries no message at all.
    expect(FieldWidgetPropsSchema.safeParse({
      value: 'x', onChange: () => {}, field: { name: 'f', type: 'text' },
    }).success).toBe(true);
    // …and it is a STRING slot, not a structured error object.
    expect(FieldWidgetPropsSchema.safeParse({
      value: 'x', onChange: () => {}, field: { name: 'f', type: 'text' }, error: { message: 'required' },
    }).success).toBe(false);
  });

  it('`field.widget` — the key that names a widget for real — is untouched', async () => {
    // The retirement's blast radius stops here, and this is the assertion that
    // says so: authors name custom widgets with a STRING on the field, and that
    // never went through `WidgetManifest`. If this ever goes red, the removal
    // took something authorable with it.
    const { FieldSchema } = await import('../data/field.zod');
    const parsed = FieldSchema.parse({ name: 'rating', type: 'number', widget: 'star_rating' });
    expect((parsed as { widget?: string }).widget).toBe('star_rating');
  });
});
