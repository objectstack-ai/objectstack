// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34714 — "Customizations in this environment": the Studio
 * landing's one list of every change this deployment made to its installed
 * apps, so "what did we change here" is answered without opening each app.
 *
 * The rows are the per-app customization read the landing already makes for
 * each installed app's card (ADR-0146 D3), handed in whole: one read per app
 * serves both the card's numbers and these rows, so the panel's total is the
 * sum of the cards' "customized" and "switched off" by construction
 * (`customizationRowsOf`, `landingCustomizations-io.ts`). Other packages'
 * contributions make no row.
 *
 * Each row names the item (its label where the app's list gives one), what
 * kind of item it is, which app it belongs to and how it changed it, and opens
 * the item in Studio. Tabs narrow by kind, a search narrows by text, and the
 * rows can be grouped by app; the first rows show, the rest behind "Show all".
 * With no change anywhere the panel is one line. An app whose read failed (a
 * 403 included) is named as unreadable, never counted as 0.
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import type { PackageCustomizations } from './packageCustomizations-io.js';
import {
  customizationRowsOf,
  loadCustomizationLabels,
  type CustomizationRow,
} from './landingCustomizations-io.js';

/** One app's read, as the landing holds it. */
export type AppCustomizationRead =
  | { kind: 'read'; read: Pick<PackageCustomizations, 'overrides' | 'extensions' | 'switchedOff'> }
  | { kind: 'failed'; message: string };

/** How many rows the panel shows before "Show all". */
export const LANDING_CUSTOMIZATION_ROWS_SHOWN = 6;

type Tab = 'all' | 'fields' | 'views' | 'flows' | 'switchedOff';
const TABS: readonly Tab[] = ['all', 'fields', 'views', 'flows', 'switchedOff'];

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
    case 'switchedOff':
      return row.mode === 'switchedOff';
  }
};

/** The kinds the panel names in words; any other type shows as served. */
const NAMED_TYPES = new Set(['object', 'field', 'validation', 'index', 'view', 'flow', 'page', 'dashboard', 'report', 'action']);
const K = 'engine.studio.landing.envCustomizations';

export function LandingCustomizationsPanel({
  apps,
  reads,
  locale,
  headingClass,
}: {
  /** The installed apps whose cards are drawn, in card order (pairs excluded). */
  apps: ReadonlyArray<{ id: string; name: string }>;
  /** Each app's read, by id; an app not yet answered is absent. */
  reads: Readonly<Record<string, AppCustomizationRead>>;
  locale: string;
  headingClass: string;
}): React.ReactElement | null {
  const rows = React.useMemo(
    () =>
      apps.flatMap((app) => {
        const r = reads[app.id];
        return r?.kind === 'read' ? customizationRowsOf(app, r.read) : [];
      }),
    [apps, reads],
  );
  const unreadable = apps.filter((app) => reads[app.id]?.kind === 'failed');
  const pending = apps.some((app) => !reads[app.id]);

  // Labels: one read per app and type that has rows, keyed on the rows drawn
  // (ui/AGENTS.md #10: the effect reads the joined keys, a primitive).
  const client = useMetadataClient();
  const [labels, setLabels] = React.useState<Record<string, Record<string, string>>>({});
  const labelTargetKey = [...new Set(rows.map((r) => r.appId))]
    .map((id) => `${id}\u0001${rows.filter((r) => r.appId === id).map((r) => r.labelKey).join('\u0002')}`)
    .join('\n');
  React.useEffect(() => {
    if (!labelTargetKey) return;
    let cancelled = false;
    for (const id of new Set(rows.map((r) => r.appId))) {
      loadCustomizationLabels(client, id, rows, locale).then(
        (found) => {
          if (!cancelled) setLabels((prev) => ({ ...prev, [id]: found }));
        },
        () => {},
      );
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelTargetKey, locale]);
  const labelOf = (row: CustomizationRow) => labels[row.appId]?.[row.labelKey] ?? row.name;

  const [tab, setTab] = React.useState<Tab>('all');
  const [query, setQuery] = React.useState('');
  const [grouped, setGrouped] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  if (apps.length === 0) return null;

  const typeText = (type: string) => (NAMED_TYPES.has(type) ? t(`${K}.type.${type}`, locale) : type);
  const needle = query.trim().toLowerCase();
  const matches = (row: CustomizationRow) =>
    !needle ||
    [labelOf(row), row.name, row.type, typeText(row.type), row.appName, t(`${K}.mode.${row.mode}`, locale)].some((s) =>
      s.toLowerCase().includes(needle),
    );
  const visible = rows.filter((r) => inTab(r, tab) && matches(r));
  const shown = grouped || expanded ? visible : visible.slice(0, LANDING_CUSTOMIZATION_ROWS_SHOWN);

  const renderRow = (row: CustomizationRow) => {
    const label = labelOf(row);
    return (
      <li
        key={row.key}
        data-testid="studio-landing-env-customization"
        data-app-id={row.appId}
        data-mode={row.mode}
        className="flex min-w-0 items-baseline gap-2 px-3 py-1.5"
      >
        <Link
          to={row.href}
          title={tFormat(`${K}.rowTitle`, locale, { name: label, app: row.appName })}
          className="min-w-0 truncate text-[12px] font-medium hover:underline"
        >
          {label}
        </Link>
        <span data-testid="studio-landing-env-customization-meta" className="shrink-0 truncate text-[10px] text-muted-foreground">
          {`${t(`${K}.mode.${row.mode}`, locale)} · ${typeText(row.type)}${grouped ? '' : ` · ${row.appName}`}`}
        </span>
      </li>
    );
  };

  const settled = !pending;
  const nothing = settled && rows.length === 0 && unreadable.length === 0;

  return (
    <section data-testid="studio-landing-env-customizations" className="mb-6">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className={`${headingClass} mb-0`}>{t(`${K}.heading`, locale)}</h2>
        {rows.length > 0 && (
          <span
            data-testid="studio-landing-env-customizations-total"
            title={tFormat(`${K}.totalTitle`, locale, { count: rows.length })}
            className="rounded bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground"
          >
            {rows.length}
          </span>
        )}
      </div>

      {unreadable.map((app) => {
        const r = reads[app.id];
        return (
          <p
            key={app.id}
            data-testid="studio-landing-env-customizations-unreadable"
            data-app-id={app.id}
            title={r?.kind === 'failed' ? r.message : undefined}
            className="mb-1 text-[11px] italic text-muted-foreground"
          >
            {tFormat(`${K}.unreadable`, locale, { name: app.name })}
          </p>
        );
      })}

      {pending && rows.length === 0 && (
        <p data-testid="studio-landing-env-customizations-loading" className="text-[11px] text-muted-foreground">
          {t(`${K}.loading`, locale)}
        </p>
      )}

      {nothing && (
        <p data-testid="studio-landing-env-customizations-empty" className="text-[11px] text-muted-foreground">
          {t(`${K}.empty`, locale)}
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
                  data-testid={`studio-landing-env-customizations-tab-${key}`}
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
            <label className="ml-auto flex min-w-0 items-center gap-1 rounded-md border px-1.5 max-md:min-h-11 max-md:w-full">
              <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(`${K}.search`, locale)}
                aria-label={t(`${K}.search`, locale)}
                data-testid="studio-landing-env-customizations-search"
                className="h-6 w-36 min-w-0 flex-1 bg-transparent text-[11px] outline-none"
              />
            </label>
            <button
              type="button"
              data-testid="studio-landing-env-customizations-group"
              aria-pressed={grouped}
              onClick={() => setGrouped((g) => !g)}
              className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted max-md:min-h-11"
            >
              {t(grouped ? `${K}.ungroup` : `${K}.groupByApp`, locale)}
            </button>
          </div>

          {visible.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">{t(`${K}.noMatch`, locale)}</p>
          ) : grouped ? (
            apps
              .filter((app) => shown.some((r) => r.appId === app.id))
              .map((app) => (
                <div key={app.id} data-testid="studio-landing-env-customizations-app" data-app-id={app.id}>
                  <h3 className="px-3 pt-2 text-[11px] font-medium text-muted-foreground">{app.name}</h3>
                  <ul>{shown.filter((r) => r.appId === app.id).map(renderRow)}</ul>
                </div>
              ))
          ) : (
            <ul className="divide-y">{shown.map(renderRow)}</ul>
          )}

          {!grouped && !expanded && visible.length > shown.length && (
            <button
              type="button"
              data-testid="studio-landing-env-customizations-show-all"
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
