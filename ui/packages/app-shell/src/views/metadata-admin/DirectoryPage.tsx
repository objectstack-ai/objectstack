// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataDirectoryPage — registry-driven landing page (Phase 3c).
 *
 * Replaces the Phase 3b placeholder. Improvements:
 *   • Search across type id + label + description.
 *   • Domain filter chips with counts.
 *   • "Writable only" toggle for admins triaging permissions work.
 *   • Tiles show: label, machine name, item count (lazy fetched per
 *     type when in view), badges (writable / overlay), description.
 *
 * Item counts are lazy — we only fetch when the user lands on a
 * domain that has it. For MVP we just show "—" until the user clicks
 * into a type. Pre-fetching all 27 counts on page load is wasteful.
 */

import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Database, Layers, Workflow, Sparkles, Settings, ShieldCheck, Box, AlertTriangle, Lock } from 'lucide-react';
import { Input } from '@object-ui/components';
import { Button } from '@object-ui/components';
import { Badge } from '@object-ui/components';
import { Kbd } from '@object-ui/components';
import { Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
import {
  useMetadataClient,
  useMetadataTypes,
  useGlobalDiagnostics,
  type RichMetadataTypeEntry,
} from './useMetadata.js';
import { MetadataQuickFind } from './QuickFind.js';
import {
  translateMetadataType,
  translateMetadataDomain,
  t,
  tFormat,
  useMetadataLocale,
} from './i18n.js';
import { buildPackageScopeOptions } from './package-scope.js';
import { diagnosticsHeaderTone, type DiagnosticsHeaderTone } from './diagnostics-tone.js';

/**
 * The "View all issues" link's look per sweep tone (objectui#12768). The
 * count comes from a `warning`-severity sweep, so it includes warnings-only
 * entries; the tone is the Diagnostics header's rule over the same entries,
 * and the warning colours are the ones that header paints, so the link and
 * the page it opens agree. The error look is the link's long-standing one.
 */
const DIAGNOSTICS_LINK_TONE_CLASS: Record<DiagnosticsHeaderTone, string> = {
  error: 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive',
  warning:
    'border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 hover:text-amber-700 dark:hover:text-amber-300',
  clean: '',
};

const DOMAIN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  data: Database,
  ui: Layers,
  automation: Workflow,
  ai: Sparkles,
  system: Settings,
  platform: Settings,
  identity: ShieldCheck,
  security: ShieldCheck,
};

const DOMAIN_ORDER = [
  'data',
  'ui',
  'automation',
  'ai',
  'identity',
  'security',
  'system',
  'platform',
  'other',
];

/**
 * Types intentionally hidden from the directory + list views.
 *
 * `field` is managed in-context via the parent object's edit form
 * (master-detail widget). A flat global list of every field across
 * every object is rarely useful and clutters the admin surface.
 *
 * `package` is the Studio scope container itself. It has a dedicated
 * management surface for create/publish/import/export flows, so exposing it
 * as scoped metadata would mean "view packages inside a package".
 */
const HIDDEN_TYPES = new Set(['field', 'package']);

export function MetadataDirectoryPage() {
  const client = useMetadataClient();
  const { loading, error, entries } = useMetadataTypes(client);
  const locale = useMetadataLocale();

  const [query, setQuery] = React.useState('');
  const [domainFilter, setDomainFilter] = React.useState<string>('all');
  const [writableOnly, setWritableOnly] = React.useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Studio is scoped to a single *project* package at a time (the sidebar
  // `active_package` selector owns the scope via `?package=`). Load the
  // installed packages and keep only project-scoped ones — anything not
  // tagged `system`/`cloud` (a missing scope counts as project). System
  // metadata therefore never appears on the directory landing.
  const [projectPackages, setProjectPackages] = React.useState<
    { id: string; name: string }[] | null
  >(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await client.list<any>('package');
        if (cancelled) return;
        setProjectPackages(buildPackageScopeOptions(list));
      } catch {
        if (!cancelled) setProjectPackages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Resolve the active package from the URL, validated against the project
  // package set. `null` while packages are still loading (fail closed).
  const urlPackage = searchParams.get('package');
  const activePackage = React.useMemo(() => {
    if (!projectPackages) return null;
    if (urlPackage && projectPackages.some((p) => p.id === urlPackage)) return urlPackage;
    return projectPackages[0]?.id ?? null;
  }, [projectPackages, urlPackage]);

  // Repair `?package=` so the sidebar selector and deep-links agree on the
  // active scope. Runs once packages resolve and the URL holds no valid
  // project package.
  React.useEffect(() => {
    if (!projectPackages || projectPackages.length === 0) return;
    if (urlPackage && projectPackages.some((p) => p.id === urlPackage)) return;
    const next = new URLSearchParams(searchParams);
    next.set('package', projectPackages[0].id);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPackages, urlPackage]);

  // Scope the diagnostics sweep to the active project package so tile
  // counts (and locked/invalid badges) reflect *that package only* and
  // match what the scoped list pages show. `undefined` while packages are
  // still resolving keeps the page in its loading state below.
  const {
    byType: invalidByType,
    warnByType,
    summary: diagSummary,
    countsByType,
    lockedByType,
    packagesByType,
    loading: diagLoading,
  } = useGlobalDiagnostics(client, 'warning', activePackage ?? undefined);
  const diagTone = diagnosticsHeaderTone(diagSummary.entries);

  // Base set: visible (non-hidden) metadata types contributed by the active
  // project package. Fail closed — show nothing until a concrete project
  // package is active, so system-only types never surface.
  const scopedEntries = React.useMemo(
    () =>
      entries.filter((e) => {
        if (HIDDEN_TYPES.has(e.type)) return false;
        if (!activePackage) return false;
        return (packagesByType[e.type] ?? []).includes(activePackage);
      }),
    [entries, activePackage, packagesByType],
  );

  // Counts per domain for the filter chip bar.
  const domainCounts = React.useMemo(() => {
    const c: Record<string, number> = { all: scopedEntries.length };
    for (const e of scopedEntries) {
      const d = e.domain ?? 'other';
      c[d] = (c[d] ?? 0) + 1;
    }
    return c;
  }, [scopedEntries]);

  const writableCount = scopedEntries.filter(
    (e) => e.allowEnvironmentOverlay || e.allowRuntimeCreate,
  ).length;

  const filtered = scopedEntries.filter((e) => {
    if (writableOnly && !(e.allowEnvironmentOverlay || e.allowRuntimeCreate)) return false;
    if (domainFilter !== 'all' && (e.domain ?? 'other') !== domainFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const hit =
        e.type.toLowerCase().includes(q) ||
        (e.label ?? '').toLowerCase().includes(q) ||
        translateMetadataType(e.type, locale, e.label).toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });

  // Group filtered by domain for display.
  const grouped = React.useMemo(() => {
    const map: Record<string, RichMetadataTypeEntry[]> = {};
    for (const e of filtered) (map[e.domain ?? 'other'] ??= []).push(e);
    return Object.entries(map).sort(([a], [b]) => {
      const ai = DOMAIN_ORDER.indexOf(a);
      const bi = DOMAIN_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [filtered]);

  if (loading || projectPackages === null || (activePackage && diagLoading)) {
    return <div className="p-6 text-sm text-muted-foreground">{t('engine.directory.loading', locale)}</div>;
  }
  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">{t('engine.directory.loadFailed', locale)}: {error}</div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b bg-background">
        <h1 className="text-xl font-semibold">{t('engine.directory.title', locale)}</h1>
        <p
          className="text-sm text-muted-foreground mt-1 max-w-3xl"
          dangerouslySetInnerHTML={{
            __html: tFormat('engine.directory.description', locale, {
              count: `<strong class="text-foreground">${scopedEntries.length}</strong>`,
              writable: writableCount,
            }),
          }}
        />

        {/* Filter row */}
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-lg">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={t('engine.directory.search', locale)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button
            variant={writableOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setWritableOnly((w) => !w)}
          >
            {t('engine.directory.writableOnly', locale)} ({writableCount})
          </Button>
          {diagSummary.total > 0 && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className={DIAGNOSTICS_LINK_TONE_CLASS[diagTone]}
            >
              <Link to="./_diagnostics" data-tone={diagTone}>
                {diagTone !== 'clean' && <AlertTriangle className="h-3.5 w-3.5 mr-1" />}
                {tFormat('engine.directory.diagnosticsLink', locale, { count: diagSummary.total })}
              </Link>
            </Button>
          )}
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            {t('engine.directory.quickFind', locale)} <Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>M</Kbd>
          </div>
        </div>

        {/* Domain chips */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          <DomainChip
            domain="all"
            label={t('engine.directory.all', locale)}
            active={domainFilter === 'all'}
            count={domainCounts.all ?? 0}
            onClick={() => setDomainFilter('all')}
          />
          {DOMAIN_ORDER.filter((d) => domainCounts[d]).map((d) => (
            <DomainChip
              key={d}
              domain={d}
              label={translateMetadataDomain(d, locale)}
              active={domainFilter === d}
              count={domainCounts[d] ?? 0}
              onClick={() => setDomainFilter(d)}
            />
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {projectPackages.length === 0 && (
          <Empty>
            <EmptyTitle>No project packages installed</EmptyTitle>
            <EmptyDescription>
              Studio only shows metadata that belongs to a project software package.
              Install or create a project package to manage its metadata here.
            </EmptyDescription>
          </Empty>
        )}
        {projectPackages.length > 0 && filtered.length === 0 && (
          <Empty>
            <EmptyTitle>{t('engine.directory.noMatches', locale)}</EmptyTitle>
            <EmptyDescription>
              {t('engine.directory.noMatchesHint', locale)}
            </EmptyDescription>
          </Empty>
        )}
        {grouped.map(([domain, group]) => {
          const Icon = DOMAIN_ICONS[domain] ?? Box;
          return (
            <section key={domain} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                {translateMetadataDomain(domain, locale)} ({group.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.map((e) => {
                  // Carry the active project package into the list-page
                  // deep-link so scope survives navigation.
                  const totalCount = countsByType[e.type] ?? 0;
                  return (
                    <TypeTile
                      key={e.type}
                      entry={e}
                      locale={locale}
                      invalidCount={invalidByType[e.type] ?? 0}
                      warnCount={warnByType[e.type] ?? 0}
                      lockedCount={lockedByType[e.type] ?? 0}
                      itemCount={totalCount}
                      packageFilter={activePackage ?? undefined}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Mount Cmd+Shift+M quickfind palette globally while this page
          is on screen. The palette itself is a Dialog so it can render
          anywhere in the tree. */}
      <MetadataQuickFind />
    </div>
  );
}

function DomainChip({
  domain,
  label,
  active,
  count,
  onClick,
}: {
  domain: string;
  label?: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-2.5 py-1 rounded-full text-xs border transition-colors ' +
        (active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background hover:bg-accent border-border text-muted-foreground')
      }
    >
      {label ?? domain} <span className="opacity-70 ml-0.5">({count})</span>
    </button>
  );
}

function TypeTile({
  entry,
  locale,
  invalidCount = 0,
  warnCount = 0,
  itemCount = 0,
  lockedCount = 0,
  packageFilter,
}: {
  entry: RichMetadataTypeEntry;
  locale?: string;
  invalidCount?: number;
  warnCount?: number;
  itemCount?: number;
  /** How many items of this type carry a lock (`_lock` ≠ `none`). */
  lockedCount?: number;
  /** When set, navigate into the list page pre-filtered to this package. */
  packageFilter?: string;
}) {
  // Prefer the locale-table translation; fall back to server's `label` (typically English).
  const label = translateMetadataType(entry.type, locale, entry.label);
  const href = packageFilter
    ? `./${encodeURIComponent(entry.type)}?package=${encodeURIComponent(packageFilter)}`
    : `./${encodeURIComponent(entry.type)}`;
  return (
    <Link
      to={href}
      className={
        'block p-4 border rounded-lg hover:bg-accent transition-colors ' +
        (invalidCount > 0
          ? 'border-destructive/40 hover:border-destructive'
          : 'hover:border-primary')
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate flex items-center gap-1.5">
            {invalidCount > 0 && (
              <span
                title={tFormat('engine.directory.invalidTooltip', locale ?? 'en', { count: invalidCount })}
                aria-label={tFormat('engine.directory.invalidTooltip', locale ?? 'en', { count: invalidCount })}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
              </span>
            )}
            {label}
          </div>
          <code className="text-xs text-muted-foreground font-mono">
            {entry.type}
          </code>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge
            variant="secondary"
            className="text-[10px] tabular-nums"
            title={tFormat('engine.directory.itemCountTooltip', locale ?? 'en', { count: itemCount })}
          >
            {itemCount}
          </Badge>
          {invalidCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] border-destructive/40 text-destructive bg-destructive/[0.06]"
              title={tFormat('engine.directory.invalidTooltip', locale ?? 'en', { count: invalidCount })}
            >
              {invalidCount}
            </Badge>
          )}
          {warnCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/[0.06]"
              title={tFormat('engine.directory.warnTooltip', locale ?? 'en', { count: warnCount })}
            >
              {warnCount}
            </Badge>
          )}
          {lockedCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/[0.06] inline-flex items-center gap-0.5 px-1.5"
              title={`${lockedCount} locked item${lockedCount === 1 ? '' : 's'} — see ADR-0010`}
              aria-label={`${lockedCount} locked items`}
            >
              <Lock className="h-2.5 w-2.5" />
              {lockedCount}
            </Badge>
          )}
          {entry.allowEnvironmentOverlay ? (
            <Badge
              className={
                'text-[10px] ' +
                (entry.overrideSource === 'env'
                  ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
                  : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100')
              }
              title={
                entry.overrideSource === 'env'
                  ? 'Writable via the OS_METADATA_WRITABLE env var: it opens the items no package ships, never an item a package ships'
                  : 'Writable per ADR-0005 overlay opt-in'
              }
            >
              {t('engine.badge.writable', locale)}
            </Badge>
          ) : entry.allowRuntimeCreate ? (
            <Badge
              className="text-[10px] bg-sky-100 text-sky-800 hover:bg-sky-100"
              title="Code-shipped items are locked; new items can be created at runtime"
            >
              {t('engine.badge.createOnly', locale)}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {t('engine.badge.readOnly', locale)}
            </Badge>
          )}
        </div>
      </div>
      {entry.description && (
        <div className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {entry.description}
        </div>
      )}
    </Link>
  );
}
