/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The spec-derived mirrors carry the spec's OBJECT-LEVEL checks (objectui#7715,
 * ruling B1, director seat, decision batch #67, maintainer 「同意」).
 *
 * ## The defect
 *
 * A mirror built as `specFieldsExcept(SpecX.shape, …)` is a fresh `ZodObject`:
 * it takes the spec's FIELDS by reference and leaves behind every check the
 * spec attached to the OBJECT (`superRefine` / `refine`). So objectui's
 * authoring door accepted a document the spec's publish door refuses — the
 * direction that gives an author, human or AI, no signal until publish.
 *
 * ## The tripwire (objectui#7122 item 6, option A — the control this card flips)
 *
 * The measured divergence: `appearance.allowedVisualizations: ['calendar']`
 * with no `calendar:` block. The spec refuses it (its
 * `checkListViewCalendarVisualization`); objectui's `ListViewSchema` accepted
 * it. The pin below asserts PARITY, so it was red on the base this card
 * branched from and turns green only when the mirror re-attaches the spec's
 * own exported check. Both legs are asserted: the spec-side refusal is re-read
 * live on every run, so a spec release that drops the rule turns this red
 * rather than leaving a pin that compares two acceptances.
 */
import { describe, it, expect } from 'vitest';
// ⛔ Schemas only. No spec `check*` function is imported by name in this file;
// they are read at RUN time by `specUiChecks()` below, and why is written there.
import {
  AppSchema as SpecAppSchema,
  DashboardSchema as SpecDashboardSchema,
  DashboardWidgetSchema as SpecDashboardWidgetSchema,
  GlobalFilterSchema as SpecGlobalFilterSchema,
  ListViewSchema as SpecListViewSchema,
  NavigationAreaSchema as SpecNavigationAreaSchema,
  PageSchema as SpecPageSchema,
} from '@objectstack/spec/ui';
import { ListViewSchema, PageNodeSchema, safeValidateSchema } from '../zod/index.zod';
import { asPageListView, bagPath } from './list-view-page-node';
import { DashboardWidgetSchema, GlobalFilterSchema } from '../zod/complex.zod';

/** The spec-shaped view: the spec requires `columns`, objectui does not. */
const specView = (extra: Record<string, unknown>) => ({ columns: ['name'], ...extra });
/** The objectui node for the same view: component discriminator + object binding. */
const node = (extra: Record<string, unknown>) => ({ type: 'list-view', objectName: 'accounts', ...extra });

const CALENDAR_OFFERED_NO_BLOCK = { appearance: { allowedVisualizations: ['calendar'] } };

describe('objectui#7715 — tripwire: the ListView calendar-visualization refusal reaches objectui', () => {
  it('the spec refuses the document, at `calendar` (the premise, re-read live)', () => {
    const r = SpecListViewSchema.safeParse(specView(CALENDAR_OFFERED_NO_BLOCK));
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'calendar');
    expect(issue?.code).toBe('custom');
  });

  it('objectui refuses the same document with the spec\'s own issue — mirror and published door', () => {
    const spec = SpecListViewSchema.safeParse(specView(CALENDAR_OFFERED_NO_BLOCK));
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === 'calendar')!;

    // The `ListView` component's props, and the page node the published door judges
    // since objectui#12670 (its props in the `properties` bag, paths read relative to it).
    const page = asPageListView(node(CALENDAR_OFFERED_NO_BLOCK));
    for (const r of [ListViewSchema.safeParse(node(CALENDAR_OFFERED_NO_BLOCK)), safeValidateSchema(page)]) {
      expect(r.success).toBe(false);
      const issues = r.error!.issues.map((i) => ({ code: i.code, path: bagPath(i.path), message: i.message }));
      // The spec's issue, derived from the spec's own parse — not a restated
      // message — so this proves the spec's check runs here, not a copy of it.
      expect(issues).toContainEqual({ code: 'custom', path: 'calendar', message: specIssue.message });
    }
  });

  it('controls: a declared `calendar` block, and a list that does not offer the calendar, pass on both doors', () => {
    const withBlock = { ...CALENDAR_OFFERED_NO_BLOCK, calendar: { startDateField: 'starts_at' } };
    const noCalendar = { appearance: { allowedVisualizations: ['grid', 'kanban'] } };
    for (const extra of [withBlock, noCalendar]) {
      expect(SpecListViewSchema.safeParse(specView(extra)).success).toBe(true);
      expect(ListViewSchema.safeParse(node(extra)).success).toBe(true);
      expect(safeValidateSchema(asPageListView(node(extra))).success).toBe(true);
    }
  });
});

// ── The Page site ────────────────────────────────────────────────────────────

const specPage = (extra: Record<string, unknown>) => ({ name: 'home_page', label: 'Home', ...extra });
const pageNode = (extra: Record<string, unknown>) => ({ type: 'page', ...extra });

describe('objectui#7715 — the Page source-completeness refusal reaches objectui', () => {
  it.each([
    ['no `source` at all', { kind: 'html' }],
    ['a whitespace-only `source`', { kind: 'react', source: '   ' }],
  ])('%s: the spec refuses at `source`, and objectui refuses with the spec\'s own issue', (_label, extra) => {
    const spec = SpecPageSchema.safeParse(specPage(extra));
    expect(spec.success).toBe(false);
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === 'source');
    expect(specIssue?.code).toBe('custom');

    for (const r of [PageNodeSchema.safeParse(pageNode(extra)), safeValidateSchema(pageNode(extra))]) {
      expect(r.success).toBe(false);
      const issues = r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
      expect(issues).toContainEqual({ code: 'custom', path: 'source', message: specIssue!.message });
    }
  });

  it('controls: a sourced page, and a page whose kind carries no source, pass on both doors', () => {
    for (const extra of [{ kind: 'html', source: '<section>x</section>' }, {}, { kind: 'full' }]) {
      expect(SpecPageSchema.safeParse(specPage(extra)).success).toBe(true);
      expect(PageNodeSchema.safeParse(pageNode(extra)).success).toBe(true);
      expect(safeValidateSchema(pageNode(extra)).success).toBe(true);
    }
  });
});

describe('objectui#11717 — the Page `requires` ⇄ `kind` refusal reaches objectui', () => {
  it.each([
    ['an absent `kind` (the spec default, `full`)', { requires: ['ui'] }],
    ['a `react` page', { kind: 'react', source: 'export default () => null', requires: ['ui'] }],
    ['a `slotted` page, with an EMPTY list', { kind: 'slotted', requires: [] }],
  ])('%s: the spec refuses at `requires`, and objectui refuses with the spec\'s own issue', (_label, extra) => {
    const spec = SpecPageSchema.safeParse(specPage(extra));
    expect(spec.success).toBe(false);
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === 'requires');
    expect(specIssue?.code).toBe('custom');

    for (const r of [PageNodeSchema.safeParse(pageNode(extra)), safeValidateSchema(pageNode(extra))]) {
      expect(r.success).toBe(false);
      const issues = r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
      expect(issues).toContainEqual({ code: 'custom', path: 'requires', message: specIssue!.message });
    }
  });

  it('controls: `requires` on a compiled `html` page, and a page that writes no `requires`, pass on both doors', () => {
    for (const extra of [{ kind: 'html', source: '<section>x</section>', requires: ['ui'] }, { kind: 'react', source: 'x' }]) {
      expect(SpecPageSchema.safeParse(specPage(extra)).success).toBe(true);
      expect(PageNodeSchema.safeParse(pageNode(extra)).success).toBe(true);
      expect(safeValidateSchema(pageNode(extra)).success).toBe(true);
    }
  });
});

describe('objectui#12030 — the Page `details` + `tabs` slot-pair refusal reaches objectui', () => {
  const BOTH = { kind: 'slotted', slots: { details: [], tabs: [] } };

  it('the spec refuses the pair at `slots.details`, and objectui refuses with the spec\'s own issue', () => {
    const spec = SpecPageSchema.safeParse(specPage(BOTH));
    expect(spec.success).toBe(false);
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === 'slots.details');
    expect(specIssue?.code).toBe('custom');

    for (const r of [PageNodeSchema.safeParse(pageNode(BOTH)), safeValidateSchema(pageNode(BOTH))]) {
      expect(r.success).toBe(false);
      const issues = r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
      expect(issues).toContainEqual({ code: 'custom', path: 'slots.details', message: specIssue!.message });
    }
  });

  it('controls: either slot alone passes on both doors', () => {
    for (const extra of [{ kind: 'slotted', slots: { tabs: [] } }, { kind: 'slotted', slots: { details: [] } }]) {
      expect(SpecPageSchema.safeParse(specPage(extra)).success).toBe(true);
      expect(PageNodeSchema.safeParse(pageNode(extra)).success).toBe(true);
      expect(safeValidateSchema(pageNode(extra)).success).toBe(true);
    }
  });
});

// objectui#12370's describe block stood here. objectstack#23784 removed the spec's page-parse
// judge of a view-data component's retired `api` binding, so objectui#12666 detached it; what the
// page doors accept now is pinned in `page-component-view-data-12666.test.ts`.

describe('objectui#12626 — the Page region-placement refusal reaches objectui', () => {
  const regions = (...names: string[]) => names.map((name) => ({ name, components: [] }));

  it.each([
    ['a region the default template does not place', { regions: regions('main', 'left_sidebar') }, 'regions.1.name'],
    ['a second region for a filled slot', { regions: regions('main', 'Main') }, 'regions.1.name'],
    ['a region `header-sidebar-main` does not place', { template: 'header-sidebar-main', regions: regions('main', 'aside') }, 'regions.1.name'],
  ])('%s: the spec refuses it, and objectui refuses with the spec\'s own issue on both page nodes', (_label, extra, at) => {
    const spec = SpecPageSchema.safeParse(specPage(extra));
    expect(spec.success).toBe(false);
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === at);
    expect(specIssue?.code).toBe('custom');

    // The `page` node through its own schema and the published door, and the page-kind node
    // (`type: 'home'`) through the published door.
    const kindNode = { ...extra, type: 'home' };
    for (const r of [PageNodeSchema.safeParse(pageNode(extra)), safeValidateSchema(pageNode(extra)), safeValidateSchema(kindNode)]) {
      expect(r.success).toBe(false);
      const issues = r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
      expect(issues).toContainEqual({ code: 'custom', path: at, message: specIssue!.message });
    }
  });

  it('controls: placed regions, any region on the open-grid `dashboard` template, and a non-`full` kind pass on both doors', () => {
    for (const extra of [
      { regions: regions('header', 'main', 'aside', 'footer') },
      { template: 'dashboard', regions: regions('header', 'kpis', 'pipeline') },
      { kind: 'slotted', regions: regions('left_sidebar') },
    ]) {
      expect(SpecPageSchema.safeParse(specPage(extra)).success).toBe(true);
      expect(PageNodeSchema.safeParse(pageNode(extra)).success).toBe(true);
      expect(safeValidateSchema(pageNode(extra)).success).toBe(true);
    }
  });
});

describe('objectui#12626 — the Page `isDefault` placement refusal reaches the page-kind node, and only there', () => {
  it('a `home` page with `isDefault`: the spec refuses at `isDefault`, and the kind node refuses with the spec\'s own issue', () => {
    const extra = { type: 'home', isDefault: true };
    const spec = SpecPageSchema.safeParse(specPage(extra));
    expect(spec.success).toBe(false);
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === 'isDefault');
    expect(specIssue?.code).toBe('custom');

    const r = safeValidateSchema(extra);
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message })))
      .toContainEqual({ code: 'custom', path: 'isDefault', message: specIssue!.message });
  });

  it('controls: a bound record page with `isDefault` passes on the spec and the kind node, and the `page` node does not judge it', () => {
    const bound = { type: 'record', object: 'account', isDefault: true };
    expect(SpecPageSchema.safeParse(specPage(bound)).success).toBe(true);
    expect(safeValidateSchema(bound).success).toBe(true);
    // The `page` node's `type` is the discriminator, so the check is not attached there:
    // the same `isDefault` on a `page` node is not refused at `isDefault`.
    const r = PageNodeSchema.safeParse(pageNode({ object: 'account', isDefault: true }));
    expect(r.success).toBe(true);
  });
});

describe('objectui#12971 — the Page `main` region width refusal reaches objectui on both page nodes', () => {
  const region = (name: string, width?: string) => ({ name, ...(width === undefined ? {} : { width }), components: [] });

  it.each([
    ['`large` on `main`', { regions: [region('main', 'large')] }, 'regions.0.width'],
    ['`small` on a `Main` region (names match case-insensitively)', { regions: [region('header'), region('Main', 'small')] }, 'regions.1.width'],
    ['`medium` on `main` of a `dashboard` page', { template: 'dashboard', regions: [region('main', 'medium')] }, 'regions.0.width'],
  ])('%s: the spec refuses it, and objectui refuses with the spec\'s own issue on both page nodes', (_label, extra, at) => {
    const spec = SpecPageSchema.safeParse(specPage(extra));
    expect(spec.success).toBe(false);
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === at);
    expect(specIssue?.code).toBe('custom');

    const kindNode = { ...extra, type: 'home' };
    for (const r of [PageNodeSchema.safeParse(pageNode(extra)), safeValidateSchema(pageNode(extra)), safeValidateSchema(kindNode)]) {
      expect(r.success).toBe(false);
      const issues = r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
      expect(issues).toContainEqual({ code: 'custom', path: at, message: specIssue!.message });
    }
  });

  it('controls: `full` on `main`, no `width` on `main`, and `large` on another region pass on the spec and both page nodes', () => {
    for (const extra of [
      { regions: [region('main', 'full')] },
      { regions: [region('main')] },
      { regions: [region('main'), region('aside', 'large')] },
    ]) {
      expect(SpecPageSchema.safeParse(specPage(extra)).success).toBe(true);
      expect(PageNodeSchema.safeParse(pageNode(extra)).success).toBe(true);
      expect(safeValidateSchema(pageNode(extra)).success).toBe(true);
      expect(safeValidateSchema({ ...extra, type: 'home' }).success).toBe(true);
    }
  });
});

describe('objectui#12971 — the Page `record` binding placement refusal reaches the page-kind node, and only there', () => {
  const record = { object: 'account' };

  it.each([
    ['a `home` page', { type: 'home', record }],
    ['a `utility` page', { type: 'utility', record }],
    ['a `record` page bound to an object', { type: 'record', object: 'account', record }],
  ])('%s with a `record` binding: the spec refuses at `record`, and the kind node refuses with the spec\'s own issue', (_label, extra) => {
    const spec = SpecPageSchema.safeParse(specPage(extra));
    expect(spec.success).toBe(false);
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === 'record');
    expect(specIssue?.code).toBe('custom');

    const r = safeValidateSchema(extra);
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message })))
      .toContainEqual({ code: 'custom', path: 'record', message: specIssue!.message });
  });

  it('controls: an `app` page with a `record` binding passes the spec, a kind page without one passes the kind node, and the `page` node does not judge it', () => {
    expect(SpecPageSchema.safeParse(specPage({ type: 'app', record })).success).toBe(true);
    expect(safeValidateSchema({ type: 'home' }).success).toBe(true);
    // The `page` node's `type` is the discriminator and the kind lives on `pageType`,
    // so the check is not attached there: a `record` binding on it is not refused at `record`.
    for (const extra of [{ pageType: 'app', record }, { record }]) {
      const r = PageNodeSchema.safeParse(pageNode(extra));
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    }
  });
});

// ── The census: every object-level check the spec runs is accounted for ─────

/**
 * The six `specFieldsExcept(...)` derivation sites the ruling names, each with
 * the spec object it rebuilds and the spec's exported checks it re-attaches or
 * declares not attachable (with the reason, which the pin below measures where
 * it can). A site's two lists must account for EVERY object-level check the
 * spec object carries today, read off `_zod.def.checks` — so a check the spec
 * adds on a later release reddens this row by name instead of being dropped.
 */
const SITES = [
  { site: 'NavigationAreaSchema (app.zod.ts)', spec: SpecNavigationAreaSchema, attached: [], notAttachable: [] },
  { site: 'SpecAppFields → AppComponentSchema (app.zod.ts)', spec: SpecAppSchema, attached: [], notAttachable: [] },
  {
    site: 'DashboardWidgetSchema (complex.zod.ts)',
    spec: SpecDashboardWidgetSchema,
    // The first two were added to the spec object at 17.5.0 and attached by objectui#11073;
    // the third is `checkDashboardWidgetChartMeasureArity` (the 17.6.0 dimensionless check,
    // renamed and given its single-series arm by objectstack `32d57690` in 17.7.0), attached
    // by objectui#11717 for objectui#11334 / objectui#11417. Each reads only `type`,
    // `options.stageOrder` / `dimensions` / `values` and `id`, the spec's own fields on this
    // node.
    attached: [
      'checkDashboardWidgetStageOrder',
      'checkDashboardWidgetMetricMeasureArity',
      'checkDashboardWidgetChartMeasureArity',
    ],
    // EMPTY since objectui#11717. It held `checkDashboardWidgetDimensionlessMeasureArity`,
    // OWED TO objectui#11334 (booked by objectui#11438 ruling A″, record 5968177777), until
    // objectui resolved an `@objectstack/spec` carrying `32d57690`: 17.7.0 exports the check
    // under its new name only, and the mirror attaches it above.
    notAttachable: [],
  },
  { site: 'SpecDashboardFields → DashboardComponentSchema (complex.zod.ts)', spec: SpecDashboardSchema, attached: [], notAttachable: [] },
  {
    site: 'SpecPageFields → PageNodeSchema (layout.zod.ts)',
    spec: SpecPageSchema,
    // `checkPageRequiresKind` joined the spec object at 17.7.0 (objectstack#21459) and was
    // attached by objectui#11717: it reads `kind` and `requires`, both carried by reference.
    // `checkPageSlotPair` joined at 18 (objectstack#22568) and was attached by objectui#12030:
    // it reads `slots`, carried by reference.
    // objectui#12370's view-data check left this list with objectui#12666: objectstack#23784
    // removed it from the spec, and 18.0.0-next.3 is the first release without it (objectstack
    // `a35f7a6`). The census below accounts for it by what it judges, not by name
    // (`specChecksRemovedOnMain`), which on the installed 18.1.0 finds nothing.
    // `checkPageRegionPlacement` joined at 18.0.0-next.2 and was attached by objectui#12626: it
    // reads `kind` and `template` (by reference) and each region's `name`, which objectui's own
    // region carries with the meaning `page.tsx` places it by; measured in its describe block above.
    // `checkPageMainRegionWidth` joined after 18.0.0-next.3 (objectstack#24326) and was attached
    // by objectui#12971: it reads each region's `name` and `width`, which objectui's own region
    // carries with the meaning `page.tsx` reads them by; measured in its describe block above.
    attached: [
      'checkPageSourceCompleteness',
      'checkPageRequiresKind',
      'checkPageSlotPair',
      'checkPageRegionPlacement',
      'checkPageMainRegionWidth',
    ],
    // `checkPagePrintComposition` joined at 18 (the `print` page, ruling B′ on objectstack#8346).
    // It reads `type` and `regions`, and this node carries NEITHER by reference: both are in
    // `PAGE_SPEC_EXCLUDED`, `type` being the component discriminator (`'page'`, or a page kind
    // on the kind node) and `regions` objectui's own `PageNodeRegionSchema` — so it is not
    // attachable here, the measurement `checkListViewPageMount` had on the list-view site.
    // `checkPageDefaultPlacement` joined at 18.0.0-next.2. It judges `isDefault` by the page's
    // `type`, which on this node is the component discriminator `'page'`, so attached it would
    // refuse every `isDefault`; `PageKindNodeSchema`, whose `type` is the page kind, attaches it
    // (objectui#12626, measured in its describe block above).
    // `checkPageRecordBindingPlacement` joined after 18.0.0-next.3 (objectstack#24275). It judges
    // `record` by the page's `type` the same way, so attached here it would refuse every `record`,
    // a `pageType: 'app'` page's included; `PageKindNodeSchema` attaches it (objectui#12971,
    // measured in its describe block above).
    notAttachable: ['checkPagePrintComposition', 'checkPageDefaultPlacement', 'checkPageRecordBindingPlacement'],
  },
  {
    site: 'ListViewSchema (objectql.zod.ts)',
    spec: SpecListViewSchema,
    attached: ['checkListViewCalendarVisualization'],
    // `checkListViewPageMount` stood here (it read `type`, which on this node is
    // the component discriminator, so it was measured not attachable). The spec
    // stopped exporting it at 17.5.0, when it retired `pageName` and the `page`
    // list-view type; the row and its measurement left together, as the
    // measurement's own message instructed (objectui#11073).
    // `checkListViewChartBinding` joined at 18 (objectstack#22491). It judges a view whose
    // `type` is `'chart'`, and on this node `type` is the component discriminator
    // (`'list-view'`; the view kind is the local `viewType`), so attached it would never
    // fire: not attachable, for the reason `checkListViewPageMount` was (objectui#12030).
    // ⚠️ This row is the flat mirror, the `ListView` component's props. The authored page
    // `list-view` node's bag (`ListViewPropsBag`, objectui#12670), whose `type` IS the spec's
    // view kind, attaches both checks by reference; `list-view-properties-bag-12670.test.ts`
    // measures each against the spec's own issue.
    notAttachable: ['checkListViewChartBinding'],
  },
] as const;

/**
 * Exported checks that belong to NO `specFieldsExcept` site. `GlobalFilterSchema`
 * is mirrored by a `.shape` spread in `complex.zod.ts` whose own `superRefine`
 * re-parses the spec-owned keys through the spec schema, so its check already
 * runs there — measured below rather than assumed.
 */
const CARRIED_ELSEWHERE = ['checkGlobalFilterDateDefaultValue'] as const;

/**
 * Every `check*` FUNCTION `@objectstack/spec/ui` exports, name → binding, read
 * at RUN time from the entry point's own module namespace.
 *
 * ⛔ Never a static named import of a check in this file. The census exists to
 * go red when the spec's set of checks MOVES, and a move is exactly when a
 * static import of one stops compiling: the `Spec Main Shape Gate` compiles
 * this repository against `@objectstack/spec` built from objectstack `main`,
 * where `checkListViewPageMount` is gone (objectstack#17063), and a named
 * import of it failed that compile with TS2305 before any row here could say
 * which site moved. Read by name at run time, an added or a removed check
 * compiles on every spec and fails below by row name instead.
 *
 * The runtime namespace is the right instrument here because these are VALUES:
 * a namespace cannot see a TYPE, which is why the repository's type-name
 * tripwires read `.d.ts` through the checker, but every name this census
 * counts is a function. A dynamic `import()` rather than `import * as`, because
 * the static namespace form of this entry point is a restricted import in this
 * repository (objectui#3090's `FormField` rule), which this read never touches.
 */
async function specUiChecks(): Promise<Map<string, unknown>> {
  const mod: object = await import('@objectstack/spec/ui');
  // Control: the namespace read is the SAME module the schemas above come
  // from, so an empty map would be a real absence and not a wrong module.
  expect(Reflect.get(mod, 'ListViewSchema')).toBe(SpecListViewSchema);
  return new Map(
    Object.keys(mod)
      .filter((name) => /^check[A-Z]/.test(name))
      .map((name) => [name, Reflect.get(mod, name)] as const),
  );
}

const objectLevelChecks = (schema: unknown): number =>
  ((schema as { _zod: { def: { checks?: unknown[] } } })._zod.def.checks ?? []).length;

const PAGE_SITE = 'SpecPageFields → PageNodeSchema (layout.zod.ts)';

/**
 * The exported page checks objectstack `main` has REMOVED but the installed
 * `@objectstack/spec` still carries, found by what they judge rather than by
 * name (objectui#12666).
 *
 * objectstack#23784 deleted the spec's page-parse judge of a view-data
 * component's retired `api` binding, and objectstack builds this repository
 * against its own spec tree, so no file here may name that export. Through
 * 18.0.0-next.2 the spec exported it and attached it to `PageSchema`, where
 * the census would miscount by one; 18.0.0-next.3 dropped it (objectstack
 * `a35f7a6`), and on the installed 18.1.0 this answers empty. This reads every
 * exported check no site names and keeps the ones that refuse a slotted
 * `object-grid` naming `api` at its `properties.data.provider`: on next.2 that
 * is exactly the removed judge, and on a spec without it the list is empty, so
 * the census is right on both trees and needs no edit at the next spec bump.
 * Any OTHER unnamed check still reddens the census below, by name.
 */
async function specChecksRemovedOnMain(): Promise<string[]> {
  const named = new Set<string>([...SITES.flatMap((s) => [...s.attached, ...s.notAttachable]), ...CARRIED_ELSEWHERE]);
  const page = { kind: 'slotted', slots: { details: [{ type: 'object-grid', properties: { data: { provider: 'api', read: { url: '/api/rows' } } } }] } };
  const removed: string[] = [];
  for (const [name, binding] of await specUiChecks()) {
    if (named.has(name) || typeof binding !== 'function') continue;
    const paths: string[] = [];
    binding(page, { addIssue: (issue: { path?: PropertyKey[] }) => paths.push((issue.path ?? []).map(String).join('.')) });
    if (paths.includes('slots.details.0.properties.data.provider')) removed.push(name);
  }
  return removed;
}

describe('objectui#7715 — census: the spec\'s object-level checks at the six derivation sites', () => {
  it.each(SITES.map((s) => [s.site, s] as const))('%s accounts for every object-level check the spec object carries', async (_site, s) => {
    const removedOnMain = s.site === PAGE_SITE ? (await specChecksRemovedOnMain()).length : 0;
    expect({
      site: s.site,
      specObjectLevelChecks: objectLevelChecks(s.spec),
    }).toEqual({
      site: s.site,
      specObjectLevelChecks: s.attached.length + s.notAttachable.length + removedOnMain,
    });
  });

  it('every `check*` the spec exports is named by exactly one site, carried elsewhere, or removed on objectstack `main`', async () => {
    const checks = await specUiChecks();
    const removedOnMain = await specChecksRemovedOnMain();
    // At most the one judge objectstack#23784 removed; zero once objectui installs a spec without it.
    expect(removedOnMain.length).toBeLessThanOrEqual(1);
    const named = [...SITES.flatMap((s) => [...s.attached, ...s.notAttachable]), ...CARRIED_ELSEWHERE, ...removedOnMain].sort();
    expect([...checks.keys()].sort()).toEqual(named);
    for (const [name, binding] of checks) expect(typeof binding, name).toBe('function');
  });

  it('the removed judge is detached: a slotted `api` binding passes objectui\'s page node (objectui#12666)', async () => {
    // The installed spec, where it still carries the judge, refuses the same page; objectui
    // no longer attaches it, so the mirror accepts it, as objectstack `main`'s spec does.
    const doc = { kind: 'slotted', slots: { details: [{ type: 'object-grid', properties: { objectName: 'task', data: { provider: 'api', read: { url: '/api/rows' } } } }] } };
    expect(PageNodeSchema.safeParse(pageNode(doc)).success).toBe(true);
    if ((await specChecksRemovedOnMain()).length === 1) {
      expect(SpecPageSchema.safeParse(specPage(doc)).success).toBe(false);
    }
  });

  it('`checkGlobalFilterDateDefaultValue` already runs on objectui\'s GlobalFilterSchema, with the spec\'s own issue', () => {
    const bad = { field: 'created_at', type: 'date', defaultValue: 'last_7_dayz' };
    const spec = SpecGlobalFilterSchema.safeParse(bad);
    expect(spec.success).toBe(false);
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === 'defaultValue')!;
    const mirror = GlobalFilterSchema.safeParse(bad);
    expect(mirror.success).toBe(false);
    expect(mirror.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message })))
      .toContainEqual({ code: 'custom', path: 'defaultValue', message: specIssue.message });
    // Control: a preset name resolves on both.
    const good = { ...bad, defaultValue: 'last_7_days' };
    expect(SpecGlobalFilterSchema.safeParse(good).success).toBe(true);
    expect(GlobalFilterSchema.safeParse(good).success).toBe(true);
  });
});

describe('objectui#11073 — the DashboardWidget checks reach objectui\'s door with the spec\'s own issue (objectui#9111\'s criterion)', () => {
  // The spec requires `id` and `values`; without them its own parse aborts before the
  // object-level check runs, and the comparison would have no spec issue to read.
  const widget = (extra: Record<string, unknown>) => ({ id: 'stages', dataset: 'pipeline', values: ['amount'], ...extra });

  it('a non-funnel widget carrying `options.stageOrder` is refused at `options.stageOrder`, as the spec refuses it', () => {
    const doc = widget({ type: 'horizontal-bar', options: { stageOrder: ['a', 'b'] } });
    const spec = SpecDashboardWidgetSchema.safeParse(doc);
    expect(spec.success).toBe(false);
    const specIssue = spec.error!.issues.find((i) => i.path.join('.') === 'options.stageOrder')!;
    expect(specIssue.code).toBe('custom');
    const mirror = DashboardWidgetSchema.safeParse(doc);
    expect(mirror.success).toBe(false);
    expect(mirror.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message })))
      .toContainEqual({ code: 'custom', path: 'options.stageOrder', message: specIssue.message });
  });

  it('LIT CONTROL: the same widget as a `funnel` parses on both', () => {
    const doc = widget({ type: 'funnel', options: { stageOrder: ['a', 'b'] } });
    expect(SpecDashboardWidgetSchema.safeParse(doc).success).toBe(true);
    expect(DashboardWidgetSchema.safeParse(doc).success).toBe(true);
  });
});

