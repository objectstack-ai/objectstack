// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * TranslationPreview — read-only coverage report for one locale bundle.
 *
 * A translation record represents exactly one locale (per the i18n ADR).
 * This preview answers two questions an operator typically has when
 * opening a translation:
 *
 *   1. "Which locale is this and how complete is it?" → header strip
 *      with the locale badge, total-key count, and an overall coverage
 *      bar (categories that have at least one entry).
 *   2. "Where are the strings?" → a card per group of the per-app
 *      `TranslationDataSchema`, the groups the designer's
 *      `validateMetadataDraft('translation', …)` judges a draft by
 *      (objectui#11765). Each card shows the count of top-level keys and
 *      a sample of up to 5 keys so the user can confirm the right
 *      bundle is loaded. A key the schema refuses (the removed
 *      `validationMessages`, the platform-only `settings`) is no group:
 *      it is neither drawn nor counted in the coverage denominator.
 *
 * messages is the one flat string map, so its sample is a small key→value
 * table. Every other group is nested, and its sample lists the top-level
 * keys with their inner key count. settingsCommon is one strict object
 * rather than a record of named nodes; its members (`sourceLabels`) are
 * its top-level keys, read the same way. globalActions entries are action
 * translation nodes (`TranslationDataSchema.globalActions.NAME`), so that
 * sample shows the node's `label`, quoted as a flat string is, and the
 * inner key count when the node carries no `label` (objectui#11755).
 */

import * as React from 'react';
import {
  AppWindow,
  ClipboardList,
  Database,
  FileText,
  Gauge,
  Globe2,
  LayoutDashboard,
  Languages,
  ListChecks,
  MessageCircle,
  PanelsTopLeft,
  Settings2,
  SquareChevronDown,
  Workflow,
} from 'lucide-react';
import { EmptyDescription } from '@object-ui/components';
import type { TranslationDataSchema } from '@objectstack/spec/system';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { t as tr, tFormat } from '../i18n.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';

type Dict = Record<string, unknown>;

interface CategoryDef {
  key: string;
  /** The catalogue row of the category's heading, read in the preview's locale (objectui#10862). */
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When true, the value is { key: string } (flat). Otherwise { key: nestedObject }. */
  flat: boolean;
  /**
   * Nested categories only: each value is a translation node whose `label` the
   * sample shows in place of its inner key count (objectui#11755).
   */
  nodeLabel?: boolean;
}

/** A group of the per-app `TranslationDataSchema`. */
type TranslationGroup = keyof (typeof TranslationDataSchema)['shape'];

/**
 * One row per group of the per-app `TranslationDataSchema`, in the schema's
 * order (objectui#11765). The schema cannot supply a group's icon or heading,
 * so the rows are written here, and `satisfies` keeps them exhaustive both
 * ways: a group the spec adds without a row here, or a row for a key the spec
 * does not declare, fails type-check. `TranslationPreview.categories-11765.test.tsx`
 * pins the same against the schema at runtime.
 */
const CATEGORY_DEFS = {
  objects: { label: 'engine.translationPreview.category.objects', icon: ListChecks, flat: false },
  picklists: { label: 'engine.translationPreview.category.picklists', icon: SquareChevronDown, flat: false },
  apps: { label: 'engine.translationPreview.category.apps', icon: AppWindow, flat: false },
  messages: { label: 'engine.translationPreview.category.messages', icon: MessageCircle, flat: true },
  globalActions: {
    label: 'engine.translationPreview.category.globalActions',
    icon: ClipboardList,
    flat: false,
    nodeLabel: true,
  },
  dashboards: { label: 'engine.translationPreview.category.dashboards', icon: LayoutDashboard, flat: false },
  datasets: { label: 'engine.translationPreview.category.datasets', icon: Database, flat: false },
  pages: { label: 'engine.translationPreview.category.pages', icon: PanelsTopLeft, flat: false },
  flows: { label: 'engine.translationPreview.category.flows', icon: Workflow, flat: false },
  metadataForms: { label: 'engine.translationPreview.category.metadataForms', icon: FileText, flat: false },
  settingsCommon: { label: 'engine.translationPreview.category.settingsCommon', icon: Settings2, flat: false },
} satisfies Record<TranslationGroup, Omit<CategoryDef, 'key'>>;

const CATEGORIES: CategoryDef[] = Object.entries(CATEGORY_DEFS).map(([key, def]) => ({ key, ...def }));

/**
 * `locale` is the designer's language, the one the preview's own words read
 * in; `bundleLocale` is the language the translation record itself carries,
 * author data shown as written (objectui#10862).
 */
export function TranslationPreview({ name, draft, locale }: MetadataPreviewProps) {
  const d = draft as Record<string, unknown>;
  const bundleLocale = (d.locale as string | undefined) ?? (d.language as string | undefined) ?? '?';
  const label = (d.label as string | undefined) ?? (d.name as string | undefined) ?? name ?? '';
  const description = d.description as string | undefined;
  const data = (d.data as Dict | undefined) ?? (d as Dict);

  const counts = CATEGORIES.map((cat) => {
    const bag = data?.[cat.key];
    if (!bag || typeof bag !== 'object') return { ...cat, count: 0, sample: [] as Array<[string, unknown]> };
    const entries = Object.entries(bag as Dict);
    return { ...cat, count: entries.length, sample: entries.slice(0, 5) };
  });

  const totalKeys = counts.reduce((sum, c) => sum + c.count, 0);
  const populated = counts.filter((c) => c.count > 0).length;
  const coverage = Math.round((populated / CATEGORIES.length) * 100);

  if (totalKeys === 0) {
    return (
      <PreviewShell hint={`translation · ${bundleLocale}`}>
        <PreviewMessage>{tr('engine.translationPreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell hint={`translation · ${bundleLocale} · ${totalKeys} keys`}>
      <PreviewErrorBoundary>
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="rounded border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <Languages className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium truncate">{label}</span>
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-mono text-emerald-800">
                    <Globe2 className="h-3 w-3" /> {bundleLocale}
                  </span>
                </div>
                {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <Gauge className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">{tr('engine.translationPreview.coverage', locale)}</span>
                  <div className="h-1.5 w-32 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${coverage}%` }}
                    />
                  </div>
                  <span className="font-mono">
                    {populated}/{CATEGORIES.length} ({coverage}%)
                  </span>
                  <span className="ml-3 text-muted-foreground">
                    {tFormat('engine.translationPreview.totalKeys', locale, { count: totalKeys })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Category grid */}
          <div className="grid gap-2 sm:grid-cols-2">
            {counts.map((c) => (
              <CategoryCard key={c.key} cat={c} locale={locale} />
            ))}
          </div>
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

function CategoryCard({
  cat,
  locale,
}: {
  cat: CategoryDef & { count: number; sample: Array<[string, unknown]> };
  locale?: string;
}) {
  const Icon = cat.icon;
  return (
    <div className={`rounded border bg-background ${cat.count === 0 ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between border-b px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{tr(cat.label, locale)}</span>
        </div>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{cat.count}</span>
      </div>
      <div className="px-2.5 py-1.5 min-h-[3.5rem]">
        {cat.count === 0 ? (
          <EmptyDescription className="text-[11px] italic">{tr('engine.translationPreview.categoryEmpty', locale)}</EmptyDescription>
        ) : (
          <ul className="space-y-0.5 text-[11px]">
            {cat.sample.map(([k, v]) => (
              <li key={k} className="flex items-baseline gap-2 truncate">
                <code className="font-mono text-muted-foreground shrink-0">{k}</code>
                <span className="truncate text-foreground/80">{renderSampleValue(v, cat, locale)}</span>
              </li>
            ))}
            {cat.count > cat.sample.length && (
              <li className="text-[10px] text-muted-foreground italic">
                {tFormat('engine.translationPreview.more', locale, { count: cat.count - cat.sample.length })}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function renderSampleValue(
  v: unknown,
  cat: Pick<CategoryDef, 'flat' | 'nodeLabel'>,
  locale: string | undefined,
): string {
  if (cat.flat) {
    if (typeof v === 'string') return `"${v}"`;
    if (v == null) return '∅';
    return String(v);
  }
  if (v && typeof v === 'object') {
    // `label` is optional on a translation node, so a node without one keeps the key count.
    const nodeLabel = (v as Dict).label;
    if (cat.nodeLabel && typeof nodeLabel === 'string') return `"${nodeLabel}"`;
    const n = Object.keys(v as Dict).length;
    return tFormat(
      n === 1 ? 'engine.translationPreview.keyCountOne' : 'engine.translationPreview.keyCountOther',
      locale,
      { count: n },
    );
  }
  return String(v ?? '∅');
}
