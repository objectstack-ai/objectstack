// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * 概览 Overview — the open package's own page, the menu's first entry
 * (objectstack#37454; ADR-0084, amended 2026-11-26, § 概览 Overview). It is
 * drawn in the frame an item's page has, the item header and its tab row
 * (`StudioItemHeader`), so a package opens like anything else Studio opens.
 *
 * This is the first phase's thin build:
 *
 *  - **The header**: the package's name; a chip that reads 系统自带 (read-only,
 *    with a lock) or 可写, from the server's writable verdict; a chip that reads
 *    使用中 or 已停用, from the row's `enabled`; the description; and the ⋯
 *    package menu (`StudioPackageMenu`), moved here from the top bar with its
 *    six rows as they were. Disable, enable and delete stay in Setup →
 *    Packages (question 1, ruled B): the menu's last row leads there.
 *  - **信息 Info**: the business fields, read-only — name, description,
 *    source, version, the package's app — with the technical ones (id,
 *    namespace, type) folded away.
 *  - **待发布 Pending**: the changes panel that exists (`DraftChangesPanel`),
 *    drawn in place, with its Publish. The host hands it in, wired to the same
 *    publish the top bar's Publish runs, so a publish from here is that
 *    publish. Its count is the tab's badge and the menu row's.
 *
 * ⛔ There is no `package` metadata type: everything here is read through the
 * package REST surface, the listed row of `GET /api/v1/packages`
 * (`fetchListedPackageManifests`, the request the surface already shares).
 * Nothing is guessed: a row with no boolean `enabled` draws no 使用中 / 已停用
 * chip, and an unknown writable verdict draws no 系统自带 / 可写 chip.
 *
 * The open tab is the address's (`?tab=pending`, `studioPackageOverviewPath`),
 * so the menu's badge can lead straight to Pending.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Loader2, Lock, Package } from 'lucide-react';
import { cn } from '@object-ui/components';
import { AppMark, type AppMarkApp } from '../../layout/AppMark.js';
import { navItemLabelText } from '../metadata-admin/previews/navItemLabel.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { StudioItemHeader, StudioTab } from './StudioItemHeader.js';
import { STUDIO_KIND_CHIP } from './studio-tokens.js';
import { fetchListedPackageManifests, type ListedPackageManifest } from './packages-io.js';
import { appHomePath, packageAppSegment, type StudioAppTarget } from './studioAppEdit.js';
import {
  STUDIO_OVERVIEW_TAB_PARAM,
  STUDIO_OVERVIEW_TABS,
  studioOverviewTab,
  type StudioOverviewTab,
} from './studioAddress.js';

/** The served `source` values the Packages page names (`engine.packages.source.*`). */
const NAMED_SOURCES = new Set(['code', 'marketplace', 'authored']);

export interface StudioPackageOverviewPageProps {
  packageId: string;
  /** The package's display name as the surface holds it (renamed in place after Edit package info). */
  packageName: string;
  /** The server's writable verdict; `null` / `undefined` while unknown draws no 系统自带 / 可写 chip. */
  writable: boolean | null | undefined;
  /** The package's published apps (the Info tab's 打开应用 row opens the first). */
  apps: readonly StudioAppTarget[];
  /** The package's app, for the header's logo; `null` draws the package glyph. */
  app: AppMarkApp | null;
  /** The open package's pending drafts, as the top bar counts them; `null` while unknown. */
  pendingCount: number | null;
  locale: string;
  /** The ⋯ package menu, or `null` where the person may not use it. */
  menu: React.ReactNode;
  /** The Pending tab's body: the changes panel, in place. Rendered only while that tab is open. */
  pending: React.ReactNode;
  /** Changes whenever the package may have changed (a publish, a revert, a rename): the row is read again. */
  refreshKey: unknown;
  /** The surface's unsaved-work veto: return false to stay. */
  beforeNavigate: () => boolean;
  navigate: (path: string) => void;
}

type RowRead = { state: 'loading' } | { state: 'failed'; error: string } | { state: 'read'; row: ListedPackageManifest | null };

function useListedRow(packageId: string, refreshKey: unknown): RowRead {
  const [read, setRead] = React.useState<RowRead>({ state: 'loading' });
  React.useEffect(() => {
    let cancelled = false;
    fetchListedPackageManifests().then(
      (rows) => {
        if (!cancelled) setRead({ state: 'read', row: rows.get(packageId) ?? null });
      },
      (e: unknown) => {
        if (!cancelled) setRead({ state: 'failed', error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [packageId, refreshKey]);
  return read;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function StudioPackageOverviewPage({
  packageId,
  packageName,
  writable,
  apps,
  app,
  pendingCount,
  locale,
  menu,
  pending,
  refreshKey,
  beforeNavigate,
  navigate,
}: StudioPackageOverviewPageProps): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = studioOverviewTab(searchParams.get(STUDIO_OVERVIEW_TAB_PARAM));
  const openTab = (next: StudioOverviewTab) => {
    if (next === tab) return;
    setSearchParams(
      (prev) => {
        const query = new URLSearchParams(prev);
        if (next === 'info') query.delete(STUDIO_OVERVIEW_TAB_PARAM);
        else query.set(STUDIO_OVERVIEW_TAB_PARAM, next);
        return query;
      },
      { replace: true },
    );
  };

  const read = useListedRow(packageId, refreshKey);
  const row = read.state === 'read' ? read.row : null;
  const manifest = row?.manifest ?? {};
  const description = text(manifest.description);
  const notSet = t('engine.studio.overview.notSet', locale);
  const readOnly = writable === false;
  const shownPending = typeof pendingCount === 'number' && pendingCount > 0 ? pendingCount : null;

  const chips = (
    <>
      {writable === true || writable === false ? (
        <span
          data-testid="studio-overview-chip-access"
          data-writable={String(writable)}
          title={readOnly ? t('engine.studio.pkg.readonlyHint', locale) : undefined}
          className={cn(
            STUDIO_KIND_CHIP,
            'gap-1',
            !readOnly && 'bg-emerald-400/15 text-emerald-700 dark:text-emerald-300',
          )}
        >
          {readOnly && <Lock className="h-3 w-3" aria-hidden="true" />}
          {t(readOnly ? 'engine.studio.overview.chip.readOnly' : 'engine.studio.overview.chip.writable', locale)}
        </span>
      ) : null}
      {typeof row?.enabled === 'boolean' ? (
        <span
          data-testid="studio-overview-chip-state"
          data-enabled={String(row.enabled)}
          className={cn(STUDIO_KIND_CHIP, row.enabled && 'bg-emerald-400/15 text-emerald-700 dark:text-emerald-300')}
        >
          {t(row.enabled ? 'engine.studio.overview.chip.enabled' : 'engine.studio.overview.chip.disabled', locale)}
        </span>
      ) : null}
    </>
  );

  const tabLabel = (id: StudioOverviewTab) =>
    t(id === 'info' ? 'engine.studio.overview.tab.info' : 'engine.studio.overview.tab.pending', locale);
  const tabs = STUDIO_OVERVIEW_TABS.map((id) => (
    <StudioTab key={id} active={tab === id} onClick={() => openTab(id)} data-testid={`studio-overview-tab-${id}`}>
      {tabLabel(id)}
      {id === 'pending' && shownPending !== null && (
        <span
          data-testid="studio-overview-tab-pending-count"
          title={tFormat('engine.studio.menu.overviewPending', locale, { count: shownPending })}
          className="tabular-nums text-muted-foreground"
        >
          {shownPending}
        </span>
      )}
    </StudioTab>
  ));

  const [firstApp] = apps;
  const sourceName =
    row?.source && NAMED_SOURCES.has(row.source) ? t(`engine.packages.source.${row.source}`, locale) : (row?.source ?? null);
  const sourceText =
    sourceName === null
      ? null
      : readOnly
        ? tFormat('engine.studio.overview.readOnlySource', locale, { source: sourceName })
        : sourceName;

  const fieldRow = (id: string, label: string, value: React.ReactNode) => (
    <div key={id} data-testid={`studio-overview-field-${id}`} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-t py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words', value === notSet && 'text-muted-foreground')}>{value}</dd>
    </div>
  );

  const info = (
    <section
      data-testid="studio-overview-info"
      aria-labelledby={`${packageId}-overview-basics`}
      className="max-w-3xl rounded-lg border bg-card px-5 py-4"
    >
      <h2 id={`${packageId}-overview-basics`} className="pb-2 text-sm font-semibold">
        {t('engine.studio.overview.basics', locale)}
      </h2>
      {read.state === 'loading' ? (
        <p className="flex items-center gap-2 border-t py-3 text-sm text-muted-foreground" data-testid="studio-overview-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        </p>
      ) : read.state === 'failed' ? (
        <p role="alert" className="border-t py-3 text-sm text-destructive" data-testid="studio-overview-load-failed">
          {tFormat('engine.studio.overview.loadFailed', locale, { error: read.error })}
        </p>
      ) : (
        <>
          <dl>
            {fieldRow('name', t('engine.studio.overview.field.name', locale), packageName)}
            {fieldRow('description', t('engine.studio.overview.field.description', locale), description ?? notSet)}
            {fieldRow('source', t('engine.studio.overview.field.source', locale), sourceText ?? notSet)}
            {fieldRow('version', t('engine.studio.overview.field.version', locale), text(manifest.version) ?? notSet)}
            {firstApp &&
              fieldRow(
                'app',
                t('engine.studio.overview.field.app', locale),
                <button
                  type="button"
                  data-testid="studio-overview-open-app"
                  onClick={() => {
                    if (!beforeNavigate()) return;
                    navigate(appHomePath(packageAppSegment(packageId, apps, firstApp)));
                  }}
                  className="text-left underline underline-offset-2 hover:text-foreground/80"
                >
                  {navItemLabelText(firstApp.label, locale) || firstApp.name}
                </button>,
              )}
          </dl>
          {/* The technical fields, folded away (ADR-0084, amended 2026-11-26: 「是不是技术元素太重」). */}
          <details data-testid="studio-overview-technical" className="group border-t pt-2.5">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
              {t('engine.studio.overview.technical', locale)}
            </summary>
            <dl className="mt-1.5">
              {fieldRow('id', t('engine.studio.overview.field.id', locale), <span className="font-mono text-xs">{packageId}</span>)}
              {fieldRow('namespace', t('engine.studio.overview.field.namespace', locale), text(manifest.namespace) ?? notSet)}
              {fieldRow('type', t('engine.studio.overview.field.type', locale), text(manifest.type) ?? notSet)}
            </dl>
          </details>
        </>
      )}
    </section>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="studio-package-overview" data-tab={tab}>
      <StudioItemHeader
        testId="studio-package-overview-header"
        leading={app ? <AppMark app={app} size="md" /> : undefined}
        icon={app ? undefined : Package}
        title={packageName}
        titleProps={{ 'data-testid': 'studio-overview-title' }}
        chips={chips}
        note={description ? <span data-testid="studio-overview-description">{description}</span> : undefined}
        actions={menu ?? undefined}
        tabs={tabs}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'info' ? (
          <div className="px-6 py-5">{info}</div>
        ) : (
          <div className="flex min-h-full flex-col py-4" data-testid="studio-overview-pending">
            <p className="max-w-3xl px-4 pb-3 text-sm text-foreground" data-testid="studio-overview-pending-note">
              {t('engine.studio.overview.pendingNote', locale)}
            </p>
            {pending}
          </div>
        )}
      </div>
    </div>
  );
}
