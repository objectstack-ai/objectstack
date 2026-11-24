// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Customizations in this environment" for one installed app, in its Setup →
 * Packages detail (objectstack#36908, epic #36890 decision 9): what this
 * deployment changed on the app, answered without opening it in Studio.
 *
 * It was the removed Studio home's panel over every installed app
 * (objectstack#34714) and the "n customized, m switched off" line on each
 * app's card (ADR-0146 D3). The home went; the package list in Setup is where
 * an administrator now looks an installed app up, so the panel is drawn in
 * that app's detail, one app at a time.
 *
 * The numbers and the rows are the server's per-package customization read
 * (`GET /api/v1/packages/:id/customizations`): "customized" counts the pair's
 * overrides, extensions and arrangements (objectstack#36833: an app whose only
 * change is a tab arrangement is customized), "switched off" the ledger's
 * switched-off items. Each row names the item (its label where the app's list
 * gives one), what kind of item it is and how it changed, and opens the item
 * in Studio. Tabs narrow by kind and a search by text; the first rows show,
 * the rest behind "Show all". A read that fails says so, never "0".
 * "Customize in Studio" opens the app there, the home card's Customize door.
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { Search, SlidersHorizontal } from 'lucide-react';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { fetchPackageCustomizations } from './packageCustomizations-io.js';
import { readActionObjects, type ActionObjects } from './switchedOffActionTargets.js';
import {
  customizationRowsOf,
  customizedCountOf,
  loadCustomizationLabels,
  type CustomizationRow,
} from './packageCustomizationRows.js';
import { studioHomePath } from './studioAddress.js';

/** How many rows the section shows before "Show all". */
export const PACKAGE_CUSTOMIZATION_ROWS_SHOWN = 6;

type Tab = 'all' | 'fields' | 'views' | 'flows' | 'arranged' | 'switchedOff';
const TABS: readonly Tab[] = ['all', 'fields', 'views', 'flows', 'arranged', 'switchedOff'];

const inTab = (row: CustomizationRow, tab: Tab): boolean => {
  switch (tab) {
    case 'all':
      return true;
    case 'fields':
      return row.mode === 'added' && row.type === 'field';
    case 'views':
      return row.type === 'view' || row.type === 'form';
    case 'flows':
      return row.type === 'flow';
    case 'arranged':
      return row.mode === 'arranged';
    case 'switchedOff':
      return row.mode === 'switchedOff';
  }
};

/** The kinds the section names in words; any other type shows as served. */
const NAMED_TYPES = new Set(['object', 'field', 'validation', 'index', 'view', 'flow', 'page', 'dashboard', 'report', 'action']);
const K = 'engine.packages.customizations';

type ReadState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'read'; rows: CustomizationRow[]; customized: number; switchedOff: number };

export function PackageCustomizationsPanel({
  packageId,
  locale,
  onNavigate,
}: {
  /** The installed base whose changes are read; never a `.custom` pair. */
  packageId: string;
  locale: string;
  /** Called when a link leaves the page (the sheet closes on it). */
  onNavigate?: () => void;
}): React.ReactElement {
  const client = useMetadataClient();
  const [state, setState] = React.useState<ReadState>({ status: 'loading' });
  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchPackageCustomizations(packageId)
      .then(async (read) => {
        // objectstack#34724 — a switched-off action's link needs its object,
        // which the ledger row does not name: read it before drawing the row.
        const hasActions = read.switchedOff.some((s) => s.type === 'action');
        const actionObjects = hasActions
          ? await readActionObjects(client, packageId).catch((): ActionObjects => ({}))
          : undefined;
        return {
          status: 'read' as const,
          rows: customizationRowsOf(packageId, read, actionObjects),
          customized: customizedCountOf(read),
          switchedOff: read.counts.switchedOff,
        };
      })
      .then(
        (next) => {
          if (!cancelled) setState(next);
        },
        (e: unknown) => {
          if (!cancelled) setState({ status: 'failed', message: e instanceof Error ? e.message : String(e) });
        },
      );
    return () => {
      cancelled = true;
    };
    // Keyed on the package alone: the client only carries the reads, and a new
    // client identity must not read again (ui/AGENTS.md #10).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);

  // Labels: one read per type that has rows, keyed on the rows drawn
  // (ui/AGENTS.md #10: the effect reads the joined keys, a primitive).
  const rows = state.status === 'read' ? state.rows : [];
  const labelTargetKey = rows.map((r) => r.labelKey).join('\n');
  const [labels, setLabels] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!labelTargetKey) return;
    let cancelled = false;
    loadCustomizationLabels(client, packageId, rows, locale).then(
      (found) => {
        if (!cancelled) setLabels(found);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelTargetKey, packageId, locale]);
  const labelOf = (row: CustomizationRow) => labels[row.labelKey] ?? row.name;

  const [tab, setTab] = React.useState<Tab>('all');
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);

  const typeText = (type: string) => (NAMED_TYPES.has(type) ? t(`${K}.type.${type}`, locale) : type);
  const metaOf = (row: CustomizationRow) =>
    row.arrangement
      ? `${t(`${K}.mode.${row.mode}`, locale)} · ${t(`${K}.arrangement.${row.arrangement}`, locale)}`
      : `${t(`${K}.mode.${row.mode}`, locale)} · ${typeText(row.type)}`;
  const needle = query.trim().toLowerCase();
  const matches = (row: CustomizationRow) =>
    !needle || [labelOf(row), row.name, metaOf(row)].some((s) => s.toLowerCase().includes(needle));
  const visible = rows.filter((r) => inTab(r, tab) && matches(r));
  const shown = expanded ? visible : visible.slice(0, PACKAGE_CUSTOMIZATION_ROWS_SHOWN);

  return (
    <section data-testid="pkg-detail-customizations" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${K}.heading`, locale)}</p>
        <Link
          to={studioHomePath(packageId)}
          onClick={onNavigate}
          title={t(`${K}.customizeTitle`, locale)}
          data-testid="pkg-detail-customize"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
        >
          <SlidersHorizontal className="h-3 w-3" />
          {t(`${K}.customize`, locale)}
        </Link>
      </div>

      {state.status === 'loading' && (
        <p data-testid="pkg-detail-customizations-summary" data-state="loading" className="text-xs text-muted-foreground">
          {t(`${K}.loading`, locale)}
        </p>
      )}
      {state.status === 'failed' && (
        // Never a "0": the read did not answer. The server's sentence is the title.
        <p
          data-testid="pkg-detail-customizations-summary"
          data-state="failed"
          title={state.message}
          className="text-xs italic text-muted-foreground"
        >
          {t(`${K}.failed`, locale)}
        </p>
      )}
      {state.status === 'read' && (
        <p data-testid="pkg-detail-customizations-summary" data-state="read" className="text-xs text-muted-foreground">
          {state.customized === 0 && state.switchedOff === 0
            ? t(`${K}.none`, locale)
            : `${tFormat(`${K}.customized`, locale, { count: state.customized })}${t(`${K}.separator`, locale)}${tFormat(
                `${K}.switchedOff`,
                locale,
                { count: state.switchedOff },
              )}`}
        </p>
      )}

      {rows.length > 0 && (
        <div className="rounded-lg border bg-background">
          <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
            {TABS.map((key) => {
              const count = rows.filter((r) => inTab(r, key)).length;
              return (
                <button
                  key={key}
                  type="button"
                  data-testid={`pkg-detail-customizations-tab-${key}`}
                  aria-pressed={tab === key}
                  onClick={() => {
                    setTab(key);
                    setExpanded(false);
                  }}
                  className={`rounded-md px-2 py-0.5 text-[11px] max-md:min-h-11 ${
                    tab === key ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  {t(`${K}.tab.${key}`, locale)} <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
            <label className="flex w-full min-w-0 items-center gap-1 rounded-md border px-1.5 max-md:min-h-11">
              <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(`${K}.search`, locale)}
                aria-label={t(`${K}.search`, locale)}
                data-testid="pkg-detail-customizations-search"
                className="h-6 min-w-0 flex-1 bg-transparent text-[11px] outline-none"
              />
            </label>
          </div>

          {visible.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">{t(`${K}.noMatch`, locale)}</p>
          ) : (
            <ul className="divide-y">
              {shown.map((row) => {
                const label = labelOf(row);
                return (
                  <li
                    key={row.key}
                    data-testid="pkg-detail-customization"
                    data-mode={row.mode}
                    className="flex min-w-0 items-baseline gap-2 px-3 py-1.5"
                  >
                    <Link
                      to={row.href}
                      onClick={onNavigate}
                      title={tFormat(`${K}.rowTitle`, locale, { name: label })}
                      className="min-w-0 truncate text-[12px] font-medium hover:underline"
                    >
                      {label}
                    </Link>
                    <span
                      data-testid="pkg-detail-customization-meta"
                      className="shrink-0 truncate text-[10px] text-muted-foreground"
                    >
                      {metaOf(row)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {!expanded && visible.length > shown.length && (
            <button
              type="button"
              data-testid="pkg-detail-customizations-show-all"
              onClick={() => setExpanded(true)}
              className="w-full border-t px-3 py-1.5 text-left text-[11px] text-primary hover:underline max-md:min-h-11"
            >
              {tFormat(`${K}.showAll`, locale, { count: visible.length })}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
