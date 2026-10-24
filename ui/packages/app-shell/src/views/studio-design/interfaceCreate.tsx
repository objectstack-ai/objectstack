// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11823 (steps 2 and 3) — what the Interfaces pillar's *New
 * dashboard*, *New report* and *New page* write, and the one question each of a
 * report and a page adds to the create dialog.
 *
 * The Interfaces rail is the open app's navigation tree, not a type index
 * (objectstack `docs/design/builder-ui.md` §6), so a create there writes two
 * documents: the item's own draft (below), and a navigation entry that links
 * it, which the pillar sends through its nav editor's save. The new leaf then
 * opens on the canvas the pillar already renders for that type: the
 * structured canvas for a dashboard or a report (`DashboardPreview` /
 * `ReportPreview`), and for a page its source beside a live preview
 * (`SourcePageEditor`).
 *
 * The bodies are the spec's minimum, and each is typed as the spec's input
 * type so a key the spec does not declare cannot be written here:
 *
 *  - a dashboard needs `widgets`, and may hold none: the canvas then offers
 *    "+ add widget";
 *  - a report is dataset-bound (ADR-0021): a non-`joined` report needs a
 *    `dataset` and at least one of its measures in `values`, or
 *    `ReportSchema` refuses it ("a report needs `dataset` + `values`"). So the
 *    dialog asks for both ({@link ReportCreateFields}). `type` and `drilldown`
 *    are written as the metadata editor's own report create seeds them, so the
 *    report's Properties panel shows the type and drill switch the report has;
 *  - a page is a source page ({@link buildPageSkeleton}): `PageSchema` refuses
 *    a source kind with an empty `source`, so it starts from a short one, and
 *    it names its page type, because an absent one parses as a record page,
 *    which a navigation entry cannot open. The dialog asks which source kind
 *    ({@link PageCreateFields}).
 *
 * Internal to app-shell: not exported from the package root.
 */

import * as React from 'react';
import type {
  Dashboard,
  DashboardNavItem,
  Page,
  PageNavItem,
  Report,
  ReportNavItem,
} from '@objectstack/spec/ui';
import { CAP_REACT_PAGES, isCapabilityEnabled } from '@object-ui/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@object-ui/components';
import { t, tFormat, type SupportedLocale } from '../metadata-admin/i18n.js';
import { useDatasetCatalog, useDatasetSemantics } from '../metadata-admin/previews/useDatasetCatalog.js';
import { datasetSelectOptions, labelBesideName } from '../metadata-admin/inspectors/dataset-picker-options.js';
import type { NavNode } from './navSurface.js';

/** The kinds the Interfaces pillar creates. */
export type InterfaceCreateKind = 'dashboard' | 'report' | 'page';

/** A report's binding, as the create dialog collects it: a dataset and one of its measures. */
export interface ReportBinding {
  dataset: string;
  measure: string;
}

/** The empty binding a report dialog opens with. */
export const NO_REPORT_BINDING: ReportBinding = { dataset: '', measure: '' };

/** Whether the binding names both a dataset and a measure. */
export function isReportBindingComplete(binding: ReportBinding): boolean {
  return binding.dataset !== '' && binding.measure !== '';
}

/** A new dashboard's draft body: no widget yet. */
export function buildDashboardSkeleton(name: string, label: string): Dashboard {
  return { name, label, widgets: [] };
}

/** A new report's draft body: bound to the chosen dataset, showing the chosen measure. */
export function buildReportSkeleton(name: string, label: string, binding: ReportBinding): Report {
  return {
    name,
    label,
    type: 'summary',
    drilldown: true,
    dataset: binding.dataset,
    values: [binding.measure],
  };
}

/**
 * The source kinds a new page is written in: the two this pillar opens on
 * their source beside a live preview (`SourcePageEditor`, ADR-0080/0081).
 * `html` is constrained JSX, parsed and never run; `react` is real React, run
 * when the page renders. The spec's third spelling, `jsx`, is a deprecated
 * alias of `html` and is never written.
 */
export type PageSourceKind = 'html' | 'react';

/**
 * The kind a page dialog starts on: `html`, the tier every deployment renders.
 * `react` runs author code, and a deployment may turn it off.
 */
export const DEFAULT_PAGE_SOURCE_KIND: PageSourceKind = 'html';

/**
 * The source kinds this deployment can render, in the order the dialog offers
 * them. `react` is left out where the host has turned the react-pages
 * capability off (`OS_PAGE_REACT=off`): the save door would accept such a page,
 * but the preview beside its editor, and the running app, would only say that
 * react pages are disabled here.
 */
export function offeredPageSourceKinds(): PageSourceKind[] {
  return isCapabilityEnabled(CAP_REACT_PAGES) ? ['html', 'react'] : ['html'];
}

/**
 * The source a new page starts from: one paragraph of `text` (the pillar passes
 * a line from its own string table, in the author's language), in the kind's
 * own syntax. No Tailwind class: page source is runtime metadata, so a utility
 * class would produce no CSS (ADR-0065).
 *
 *  - `html`: a `flex` column, the block the html tier lays a page out with.
 *    The parser reads text up to the next `<` or `{` and has no escapes, so
 *    `text` must hold neither (the pins hold every locale's line to that).
 *  - `react`: a `function` the runtime renders (a source starting with
 *    `function` gets its default export implicitly).
 */
export function pageStarterSource(kind: PageSourceKind, text: string): string {
  if (kind === 'react') {
    return [
      'function Page() {',
      '  return (',
      "    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>",
      `      <p>${text}</p>`,
      '    </div>',
      '  );',
      '}',
      '',
    ].join('\n');
  }
  return ['<flex direction="col" gap={4}>', `  <p>${text}</p>`, '</flex>', ''].join('\n');
}

/**
 * A new page's draft body: a source page of the chosen kind.
 *
 * `type: 'app'` (an app-level page, opened from the app's navigation) is
 * written because `PageSchema` defaults an absent `type` to `record`, and a
 * record page needs a record id that a `page` navigation entry cannot pass:
 * the entry would open a broken page, and the navigation editor's own target
 * picker leaves record pages out (`isStaticPageOption`).
 */
export function buildPageSkeleton(name: string, label: string, kind: PageSourceKind, starterText: string): Page {
  return { name, label, type: 'app', kind, source: pageStarterSource(kind, starterText) };
}

/** Every nav entry `id` in the tree, at every depth. */
function navIdsOf(nodes: NavNode[], into: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    if (typeof n.id === 'string' && n.id) into.add(n.id);
    if (Array.isArray(n.children)) navIdsOf(n.children, into);
  }
  return into;
}

/**
 * The navigation entry that links a new item, with an `id` no entry of the
 * tree holds yet (`nav_NAME`, then `nav_NAME_2`, …).
 *
 * A dashboard entry carries NO `label`: the spec's absent label inherits, at
 * render time, the dashboard's current label (the rule objectui#11201 applies
 * to the entries a new app is seeded with), so renaming the dashboard renames
 * the entry. A report or a page entry carries the label the author typed,
 * because the spec's inheritance stops at object, view and dashboard targets:
 * a label-less report or page entry shows its `reportName` / `pageName`, in
 * the running app's sidebar as here.
 */
export function interfaceNavEntry(
  kind: InterfaceCreateKind,
  name: string,
  label: string,
  navigation: NavNode[],
): DashboardNavItem | ReportNavItem | PageNavItem {
  const taken = navIdsOf(navigation);
  let id = `nav_${name}`;
  for (let n = 2; taken.has(id); n++) id = `nav_${name}_${n}`;
  if (kind === 'dashboard') return { id, type: 'dashboard', dashboardName: name };
  if (kind === 'report') return { id, type: 'report', reportName: name, label };
  return { id, type: 'page', pageName: name, label };
}

/** The item a value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/** The classes a picker takes, at the size the native control had. */
const PICKER = 'h-auto px-2 py-1.5 text-sm';

/**
 * objectui#11865 — one of the create dialog's pickers (the page's source kind,
 * the report's dataset and its measure), drawn with the shared `Select`, the
 * control the rest of Studio picks with. They used to be browser-native
 * `<select>`s. What a pick writes is unchanged: `onPick` receives the picked
 * option's own `value`, the string the native control's `change` carried, and
 * each caller turns it into the same `onChange` value as before. Re-picking
 * the current option writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value. The dataset and measure
 *   pickers open on an option whose value is `''` ("Choose a dataset…",
 *   "Choose a measure…"), which `SelectItem` refuses; an index cannot collide
 *   with a dataset's or a measure's name, as any stand-in string could.
 * - A value none of the options carries gets an item of its own, labelled with
 *   the value, so the trigger shows what the form holds and would write. The
 *   native control showed its first option there ("HTML", "Choose a
 *   dataset…", "Choose a measure…"). Picking that item writes nothing.
 * - Read-only has no state here: a read-only package offers no create entry,
 *   so the dialog never opens there.
 * - Each caller keeps the picker inside its `<label>`, which names the trigger
 *   as it named the native control.
 */
function CreatePicker({
  value,
  options,
  onPick,
  testId,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  testId: string;
}): React.ReactElement {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the form's own value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger data-testid={testId} className={PICKER}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The page's source kind in the create dialog, from the kinds this deployment
 * renders ({@link offeredPageSourceKinds}). The kind cannot be changed in the
 * Studio once the page exists (its Properties tab edits no kind), so it is
 * asked here, starting on {@link DEFAULT_PAGE_SOURCE_KIND}.
 */
export function PageCreateFields({
  value,
  onChange,
  locale,
}: {
  value: PageSourceKind;
  onChange: (next: PageSourceKind) => void;
  locale: SupportedLocale;
}): React.ReactElement {
  const kinds = offeredPageSourceKinds().map((kind) => ({
    value: kind,
    label:
      kind === 'react'
        ? t('engine.studio.interfaces.create.pageKindReact', locale)
        : t('engine.studio.interfaces.create.pageKindHtml', locale),
  }));
  return (
    <div className="space-y-1.5">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t('engine.studio.interfaces.create.pageKind', locale)}</span>
        <CreatePicker
          value={value}
          options={kinds}
          onPick={(picked) => onChange(picked === 'react' ? 'react' : 'html')}
          testId="create-page-kind"
        />
      </label>
      <p className="text-[11px] text-muted-foreground" data-testid="create-page-kind-hint">
        {value === 'react'
          ? t('engine.studio.interfaces.create.pageKindReactHint', locale)
          : t('engine.studio.interfaces.create.pageKindHtmlHint', locale)}
      </p>
    </div>
  );
}

/**
 * The report's binding in the create dialog: the dataset it reads and one of
 * that dataset's measures, offered from the same catalog the report's
 * Properties panel binds from (`useDatasetCatalog`). Nothing is chosen for
 * the author: both start empty, and a dataset change clears the measure.
 */
export function ReportCreateFields({
  value,
  onChange,
  locale,
}: {
  value: ReportBinding;
  onChange: (next: ReportBinding) => void;
  locale: SupportedLocale;
}): React.ReactElement {
  const catalog = useDatasetCatalog();
  const semantics = useDatasetSemantics(value.dataset || undefined, catalog);
  const datasetOptions = [
    { value: '', label: t('engine.studio.interfaces.create.datasetPlaceholder', locale) },
    ...datasetSelectOptions(catalog.datasets),
  ];
  const measureOptions = [
    { value: '', label: t('engine.studio.interfaces.create.measurePlaceholder', locale) },
    ...semantics.measures.map((m) => ({ value: m.name, label: labelBesideName(m.name, m.label) })),
  ];

  if (catalog.loading) {
    return <p className="text-xs text-muted-foreground">{t('engine.studio.loading', locale)}</p>;
  }
  if (catalog.error && catalog.datasets.length === 0) {
    return (
      <p className="text-xs text-destructive" data-testid="create-report-datasets-failed">
        {tFormat('engine.studio.interfaces.create.datasetsFailed', locale, { error: catalog.error })}
      </p>
    );
  }
  if (catalog.datasets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="create-report-no-datasets">
        {t('engine.studio.interfaces.create.noDatasets', locale)}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t('engine.studio.interfaces.create.dataset', locale)}</span>
        <CreatePicker
          value={value.dataset}
          options={datasetOptions}
          onPick={(picked) => onChange({ dataset: picked, measure: '' })}
          testId="create-report-dataset"
        />
      </label>
      {value.dataset !== '' && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t('engine.studio.interfaces.create.measure', locale)}</span>
          {semantics.loading ? (
            <span className="block text-xs text-muted-foreground">{t('engine.studio.loading', locale)}</span>
          ) : semantics.measures.length === 0 ? (
            <span className="block text-xs text-muted-foreground" data-testid="create-report-no-measures">
              {semantics.error ?? t('engine.studio.interfaces.create.noMeasures', locale)}
            </span>
          ) : (
            <CreatePicker
              value={value.measure}
              options={measureOptions}
              onPick={(picked) => onChange({ dataset: value.dataset, measure: picked })}
              testId="create-report-measure"
            />
          )}
        </label>
      )}
      <p className="text-[11px] text-muted-foreground">{t('engine.studio.interfaces.create.reportHint', locale)}</p>
    </div>
  );
}
