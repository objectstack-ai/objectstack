// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25922 slices S2 to S6 — the designer rows that moved into
 * `@object-ui/i18n`'s `studio` namespace (every `engine.inspector.*` row;
 * `engine.packages.*`, `engine.form.*`, `engine.edit.*`; all of
 * `engine.studio.*`; the data source pages, the field types, the metadata
 * preview panes, the flow designer and the rest of the Studio chrome), and
 * app-shell's `t()` / `tOptional()` still answer every one of them the way they
 * did when the rows sat in its own table.
 *
 * What would break it:
 *   - a row copied back into the app-shell table with a different value — the
 *     table is asked first, so it would shadow the namespace silently;
 *   - the namespace fallback dropped from `lookupString` — every moved key
 *     would echo back as itself;
 *   - a family emptied out of the namespace, which every per-key assertion
 *     below would then pass over nothing. The floors are per FAMILY, by name,
 *     so one family draining cannot hide behind another one growing.
 *
 * The oracle is the namespace's own catalogues, read through
 * `loadStudioCatalogue` (the module's public door), not a copy of their text.
 */
import { describe, expect, it } from 'vitest';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { t, tOptional } from '../i18n';

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
});

/**
 * The zh-only families among the moved rows, with the fewest keys each may
 * carry. The package form's help text reads its English from the producer's own
 * `.describe()` sentence; the flow node labels and hints and the flow enum
 * values read theirs from the engine descriptor or the value itself. Each is
 * read through `tOptional` or a `lookupString` fallback (`ZH_ONLY_FAMILIES` in
 * `ui/scripts/check-i18n-designer-table-parity.mjs` carries the reasons).
 */
const ZH_ONLY_FLOOR: Readonly<Record<string, number>> = Object.freeze({
  'engine.packages.form.help.': 9,
  'engine.flowNode.': 40,
  'engine.enum.': 4,
});

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
