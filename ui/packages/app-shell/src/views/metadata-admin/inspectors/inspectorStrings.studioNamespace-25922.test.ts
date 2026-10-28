// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25922 slices S2 to S7 — the designer rows that moved into
 * `@object-ui/i18n`'s `studio` namespace (every `engine.inspector.*` row;
 * `engine.packages.*`, `engine.form.*`, `engine.edit.*`; all of
 * `engine.studio.*`; the data source pages, the field types, the metadata
 * preview panes, the flow designer, the rest of the Studio chrome and, last,
 * the translation preview), and
 * app-shell's `t()` / `tOptional()` still answer every one of them the way they
 * did when the rows sat in its own table. Slice S7 deleted that table and the
 * table-first lookup, so the namespace is the only home.
 *
 * What would break it:
 *   - a lookup asked in front of the namespace again (a table brought back
 *     with a row whose value differs) — it would shadow the namespace silently;
 *   - the namespace dropped from `lookupString` — every moved key
 *     would echo back as itself;
 *   - a family emptied out of the namespace, which every per-key assertion
 *     below would then pass over nothing. The floors are per FAMILY, by name,
 *     so one family draining cannot hide behind another one growing.
 *
 * The oracle is the namespace's own catalogues, read through
 * `loadStudioCatalogue` (the module's public door), not a copy of their text.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { t, tOptional } from '../i18n';
// The i18n pin's own family list (a test-support module, not a package export).
import { STUDIO_ZH_ONLY_FAMILIES } from '../../../../../i18n/src/__tests__/studio-zh-only-families';

const EN = await loadStudioCatalogue('en');
// Resident before any case, so the zh lookups below read synchronously.
const ZH = await loadStudioCatalogue('zh');

/** Key prefix → the fewest `en` keys it may carry (measured at the move, rounded down). */
const FAMILY_FLOOR: Readonly<Record<string, number>> = Object.freeze({
  // S2
  'engine.inspector.pageBlock.': 160,
  'engine.inspector.action.': 120,
  'engine.inspector.dataset.': 80,
  'engine.inspector.flowNode.': 40,
  'engine.inspector.appNav.': 40,
  'engine.inspector.widget.': 40,
  // S3 — the rest of the inspectors, and the package, form and editor chrome
  'engine.inspector.': 700,
  'engine.packages.': 120,
  'engine.form.': 90,
  'engine.edit.': 90,
  // S4 — five Studio pillars, the data source pages, the field types
  'engine.studio.access.': 120,
  'engine.studio.if.': 50,
  'engine.studio.data.': 45,
  'engine.studio.auto.': 40,
  'engine.studio.settings.': 35,
  'engine.datasource.': 50,
  'engine.externalDatasource.': 45,
  'engine.datasourcePreview.': 10,
  'engine.fieldType.': 45,
  'engine.fieldTypeDesc.': 45,
  'engine.fieldCategory.': 9,
  // S5 — the rest of engine.studio (its inspector aside) and the preview panes
  'engine.studio.': 600,
  'engine.studio.rules.': 55,
  'engine.studio.interfaces.': 30,
  'engine.studio.designer.': 20,
  'engine.actionPreview.': 50,
  'engine.permissionPreview.': 35,
  'engine.validationPreview.': 30,
  'engine.jobPreview.': 18,
  'engine.agentPreview.': 15,
  'engine.skillPreview.': 15,
  'engine.datasetPreview.': 12,
  'engine.toolPreview.': 12,
  'engine.picklistPreview.': 12,
  'engine.dashboardPreview.': 9,
  'engine.appPreview.': 9,
  'engine.emailTemplatePreview.': 9,
  'engine.pagePreview.': 8,
  'engine.screenPreview.': 7,
  'engine.positionPreview.': 6,
  'engine.reportPreview.': 6,
  'engine.viewPreview.': 4,
  'engine.objectPreview.': 1,
  'engine.previewShell.': 1,
  // S6 — the rest of the table (engine.translationPreview aside): the flow
  // designer, the page-block canvas, the doc and book previews, the Studio
  // inspector and the remaining chrome
  'engine.studio.inspector.': 30,
  'engine.flowSim.': 60,
  'engine.flowCanvas.': 20,
  'engine.flowRuns.': 18,
  'engine.flowPreview.': 15,
  'engine.flowScope.': 15,
  'engine.flowValidate.': 15,
  'engine.flowProblems.': 9,
  'engine.flowPalette.': 8,
  'engine.flowExpr.': 6,
  'engine.flowRef.': 5,
  'engine.flowRegion.': 4,
  'engine.pageBlockCanvas.': 55,
  'engine.list.': 30,
  'engine.docPreview.': 25,
  'engine.catalog.': 25,
  'engine.bookPreview.': 20,
  'engine.sharingRule.': 15,
  'engine.widgetPicker.': 15,
  'engine.layers.': 15,
  'engine.diagnostics.': 15,
  'engine.directory.': 14,
  'engine.draftConflict.': 10,
  'engine.validation.': 10,
  'engine.position.': 9,
  'engine.appNav.': 8,
  'engine.embedded.': 7,
  'engine.quickfind.': 5,
  'engine.badge.': 3,
  'engine.fieldsListEditor.': 3,
  'engine.typeAction.': 2,
  'engine.celTest.': 2,
  'engine.sourcePageEditor.': 2,
  'engine.condition.': 2,
  'engine.celLint.': 1,
  'engine.package.': 1,
  'engine.breadcrumb.': 1,
  'engine.repeater.': 1,
  'engine.viewColumnPanes.': 1,
  'engine.home.': 1,
  'engine.cancel': 1,
  'engine.close': 1,
  // S6b — the translation preview, the table's last family
  'engine.translationPreview.': 20,
});

/**
 * The zh-only families among the moved rows, with the fewest keys each may
 * carry. The package form's help text reads its English from the producer's own
 * `.describe()` sentence; the flow node labels and hints and the flow enum
 * values read theirs from the engine descriptor or the value itself. Each is
 * read through `tOptional` or a `lookupString` fallback; `ZH_ONLY_REASONS`
 * below carries the reasons.
 */
const ZH_ONLY_FLOOR: Readonly<Record<string, number>> = Object.freeze({
  'engine.packages.form.help.': 9,
  'engine.flowNode.': 40,
  'engine.enum.': 4,
});

/**
 * Why each zh-only family has no `en` row, and the reader that says so. Moved
 * here from the retired `check:i18n-designer-parity` gate with slice S7. A
 * citation is `{ file, anchor }`, the anchor is TEXT and never a line number,
 * and it must occur exactly once in its file or it stops locating anything.
 * Its prefixes are held equal to `STUDIO_ZH_ONLY_FAMILIES`, the list the i18n
 * pin `studio-namespace.test.ts` allows, so neither can widen alone.
 */
const ZH_ONLY_REASONS = Object.freeze([
  {
    prefix: 'engine.flowNode.',
    reason:
      'zh-only by design: for English the flow palette falls back to the engine descriptor’s own ' +
      'server-authoritative name/description, so an `en` row would OVERRIDE the server',
    file: '../i18n.ts',
    anchor: 'resolved by translateNodeLabel/Hint',
  },
  {
    prefix: 'engine.enum.type.',
    reason:
      'zh-only by construction: translateEnumOption returns the raw value before it ever looks the ' +
      'key up for any non-zh locale, so an `en` row is unreachable',
    file: '../i18n.ts',
    anchor: 'export function translateEnumOption',
  },
  {
    prefix: 'engine.packages.form.help.',
    reason:
      'zh-only on purpose: with no `en` row tOptional returns undefined, helpText drops out, and the row ' +
      'falls back to ManifestSchema’s .describe() in @objectstack/spec — an `en` row would copy that ' +
      'text into a second producer, against AGENTS.md #0.1',
    file: '../package-schema.ts',
    anchor: 'en-US deliberately has NO entry',
  },
]);

const familyKeys = (prefix: string): string[] => Object.keys(EN).filter((key) => key.startsWith(prefix));

describe('moved designer rows answer from the studio namespace (objectstack#25922)', () => {
  it.each(Object.entries(FAMILY_FLOOR))('%s: the namespace carries the family, in en and zh', (prefix, floor) => {
    const keys = familyKeys(prefix);
    expect(keys.length).toBeGreaterThanOrEqual(floor);
    expect(keys.filter((key) => !(key in ZH))).toEqual([]);
  });

  it.each(Object.keys(FAMILY_FLOOR))('%s: t() answers every key with the namespace value', (prefix) => {
    const wrong = familyKeys(prefix).flatMap((key) => {
      const out: string[] = [];
      if (t(key, 'en-US') !== EN[key]) out.push(`en-US ${key}: ${t(key, 'en-US')}`);
      if (t(key, 'zh-CN') !== ZH[key]) out.push(`zh-CN ${key}: ${t(key, 'zh-CN')}`);
      // A language the namespace has no catalogue for reads English, as it did
      // from the app-shell table.
      if (t(key, 'de-DE') !== EN[key]) out.push(`de-DE ${key}: ${t(key, 'de-DE')}`);
      return out;
    });
    expect(wrong).toEqual([]);
  });

  it.each(Object.entries(ZH_ONLY_FLOOR))('%s: the zh-only rows stay optional lookups: zh answers, en finds nothing', (prefix, floor) => {
    const keys = Object.keys(ZH).filter((key) => key.startsWith(prefix));
    expect(keys.length).toBeGreaterThanOrEqual(floor);
    expect(keys.filter((key) => key in EN)).toEqual([]);
    expect(keys.filter((key) => tOptional(key, 'zh-CN') !== ZH[key])).toEqual([]);
    expect(keys.filter((key) => tOptional(key, 'en-US') !== undefined)).toEqual([]);
  });
});

describe('the namespace is the only home (objectstack#25922 slice S7)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const zhOnly = Object.keys(ZH).filter((key) => !(key in EN));

  it('every namespace key answers through t() and tOptional() with its catalogue value', () => {
    // Every key, not a family sample: with the table gone nothing else may
    // answer, so a lookup in front of the namespace shows up here by key.
    expect(Object.keys(EN).length).toBeGreaterThan(3000);
    const wrong = Object.keys(EN).flatMap((key) => {
      const out: string[] = [];
      const zh = ZH[key] ?? EN[key];
      for (const locale of ['en-US', 'en', 'de-DE', undefined]) {
        if (t(key, locale) !== EN[key]) out.push(`t ${locale} ${key}`);
        if (tOptional(key, locale) !== EN[key]) out.push(`tOptional ${locale} ${key}`);
      }
      for (const locale of ['zh-CN', 'zh', 'zh-TW']) {
        if (t(key, locale) !== zh) out.push(`t ${locale} ${key}`);
        if (tOptional(key, locale) !== zh) out.push(`tOptional ${locale} ${key}`);
      }
      return out;
    });
    expect(wrong).toEqual([]);
  });

  it('the zh-only rows are the documented families, and answer in zh alone', () => {
    // 54 at the move (9 package form help rows, 41 flow node rows, 4 flow enum
    // values); all of them belong to a family with a reason below.
    expect(zhOnly.length).toBeGreaterThanOrEqual(50);
    expect(zhOnly.filter((key) => !ZH_ONLY_REASONS.some((f) => key.startsWith(f.prefix)))).toEqual([]);
    const wrong = zhOnly.flatMap((key) => [
      ...['en-US', 'en', 'de-DE', undefined].filter((locale) => tOptional(key, locale) !== undefined).map((l) => `en-side ${l} ${key}`),
      ...['zh-CN', 'zh', 'zh-TW'].filter((locale) => tOptional(key, locale) !== ZH[key]).map((l) => `zh-side ${l} ${key}`),
    ]);
    expect(wrong).toEqual([]);
  });

  it('a reason is given for exactly the families the i18n pin allows', () => {
    expect(ZH_ONLY_REASONS.map((f) => f.prefix).sort()).toEqual([...STUDIO_ZH_ONLY_FAMILIES].sort());
  });

  it.each(ZH_ONLY_REASONS.map((f) => [f.prefix, f] as const))('%s: its citation anchor occurs exactly once', (_prefix, family) => {
    const text = readFileSync(path.join(here, family.file), 'utf8');
    expect(text.split(family.anchor).length - 1).toBe(1);
  });
});
