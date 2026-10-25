// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PageShell — common hero / breadcrumb / action bar for every metadata
 * admin page (Phase 3c).
 *
 * Layout (top → bottom):
 *   1. Breadcrumb: All Metadata Types › <type> [ › <item> ]
 *   2. Hero: icon + label + writable badge + count chip
 *   3. Description (one line)
 *   4. Action toolbar (Create / Refresh / Reset / Delete)
 *   5. Child content (list / form / history)
 *
 * Keeping the chrome here means every page looks consistent and
 * page bodies stay focused on their domain logic.
 */

import * as React from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Badge } from '@object-ui/components';
import { ChevronRight } from 'lucide-react';
import type { RichMetadataTypeEntry } from './useMetadata.js';
import { useMetadataLocale, t, translateMetadataType, translateMetadataDomain } from './i18n.js';
import { environmentScopeSuffix } from './catalog-scope.js';

export interface PageShellProps {
  /** The type entry from `/meta/types` (or a synthesized stub). */
  entry: RichMetadataTypeEntry | undefined;
  /** Optional item name (shown in breadcrumb on edit/history). */
  itemName?: string;
  /** Sub-label below the title — e.g. "Edit overlay" / "Version history". */
  subtitle?: string;
  /** Right-side stat chips. */
  stats?: Array<{ label: string; value: React.ReactNode }>;
  /** Right-side action buttons. */
  actions?: React.ReactNode;
  /**
   * When true, the shell is hosted inside another surface (e.g. the Studio
   * Access pillar) instead of the routed metadata admin. The breadcrumb
   * renders as plain text: its links resolve to `/metadata` routes that do
   * not exist under the host's router scope, so following them would yank
   * the user out of the embedding surface (the host provides its own
   * navigation).
   */
  embedded?: boolean;
  /**
   * Host-level read-only gate — set by a Studio pillar when the surrounding
   * PACKAGE is read-only. Independent of, and dominant over, the TYPE-level
   * writability the badge below otherwise reports: the registry may well allow
   * org overlays for this type (`permission` is one of the 15 overlay-allowed
   * types) while THIS package forbids every write, and the header must report
   * the state that actually governs the screen.
   *
   * Display-side only — the shell gates nothing. It exists because the header
   * used to render a "writable" badge above 207 disabled checkboxes and a
   * disabled Publish (objectui#4036, B-half of the objectstack#5768 split
   * ruling): the host already computed the right answer for its controls and
   * simply had no way to tell the chrome.
   */
  readOnly?: boolean;
  /** Page body. */
  children: React.ReactNode;
}

/**
 * The writability badge slot — one of four mutually exclusive states, rendered
 * identically in the compact (detail) and hero (list) headers. Extracted so the
 * host read-only gate cannot be honoured in one header and forgotten in the
 * other, which is the shape of the bug that motivated it.
 */
export function WritabilityBadge({
  entry,
  readOnly,
  locale,
  compact,
}: {
  entry: RichMetadataTypeEntry | undefined;
  readOnly: boolean;
  locale: string;
  compact?: boolean;
}): React.ReactElement {
  const size = compact ? 'text-[10px] h-5 px-1.5' : 'text-[10px]';

  // Host gate first: a read-only package overrides whatever the type registry
  // says, because no write can be initiated from this screen regardless. The
  // tooltip names the package as the reason, matching the wording the Studio
  // top bar and the identity strip already use for the same gate.
  if (readOnly) {
    return (
      <Badge
        variant="outline"
        className={`${size} text-muted-foreground`}
        title={t('engine.studio.pkg.readonlyHint', locale)}
      >
        {t('engine.badge.readOnly', locale)}
      </Badge>
    );
  }

  if (entry?.allowEnvironmentOverlay) {
    return (
      <Badge
        className={
          `${size} ` +
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
    );
  }

  if (entry?.allowRuntimeCreate) {
    return (
      <Badge
        className={`${size} bg-sky-100 text-sky-800 hover:bg-sky-100`}
        title="Code-shipped items are locked; new items can be created at runtime"
      >
        {t('engine.badge.createOnly', locale)}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={`${size} text-muted-foreground`}>
      {t('engine.badge.readOnly', locale)}
    </Badge>
  );
}

export function PageShell({
  entry,
  itemName,
  subtitle,
  stats,
  actions,
  embedded = false,
  readOnly = false,
  children,
}: PageShellProps) {
  const type = entry?.type ?? '';
  const locale = useMetadataLocale();
  // Prefer locale-table translation over server's English label.
  const label = translateMetadataType(type, locale, entry?.label);

  // Compute base path up to /metadata so breadcrumb links work regardless
  // of how deep the current route is (list, edit, history, …).
  const { pathname } = useLocation();
  const metadataBase = React.useMemo(() => {
    const idx = pathname.indexOf('/metadata');
    return idx >= 0 ? pathname.slice(0, idx + '/metadata'.length) : '/metadata';
  }, [pathname]);
  // objectui#7611 — an editor opened from the Setup catalog returns to the
  // Setup catalog, not to the package-scoped Studio list of the same type.
  const [search] = useSearchParams();
  const scopeSuffix = environmentScopeSuffix(search);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      {itemName ? (
        // Compact single-line header for detail pages. The big hero title
        // adds nothing once you've drilled into a specific item — the
        // breadcrumb already names the type and the item, and meta badges
        // sit inline to free a full row of vertical chrome.
        //
        // objectui#12306 — the row WRAPS when its content does not fit. It
        // used to be a no-wrap row whose `shrink-0` chip, stat and action
        // groups squeezed the `min-w-0` breadcrumb, whose own `shrink-0`
        // links then painted underneath the chips (at an 820px window the
        // breadcrumb box was 0px wide). Now everything after the breadcrumb
        // travels as ONE cluster: `flex-auto` keeps its basis at its content
        // width, so when it cannot sit beside the breadcrumb it moves to the
        // next line as a whole and the breadcrumb keeps a line to itself,
        // truncating the item name only when that line is narrower than it.
        // `flex-1` would zero the basis and bring the squeeze back.
        <div className="px-6 py-2.5 border-b bg-background flex flex-wrap items-center gap-x-3 gap-y-1.5 min-h-[44px]">
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
            {embedded ? (
              <span className="shrink-0">{label}</span>
            ) : (
              <>
                <Link to={metadataBase} className="hover:text-foreground shrink-0">
                  {t('engine.breadcrumb.allTypes', locale)}
                </Link>
                <ChevronRight className="h-3 w-3 shrink-0" />
                <Link
                  to={`${metadataBase}/${encodeURIComponent(type)}${scopeSuffix}`}
                  className="hover:text-foreground shrink-0"
                >
                  {label}
                </Link>
              </>
            )}
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span
              className="text-foreground font-medium font-mono truncate"
              title={itemName}
            >
              {itemName}
            </span>
          </nav>
          <div
            className="flex flex-auto flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0"
            data-testid="page-shell-header-meta"
          >
            <div className="flex items-center gap-1.5 shrink-0">
              {entry?.domain && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wider h-5 px-1.5"
                >
                  {translateMetadataDomain(entry.domain, locale)}
                </Badge>
              )}
              <WritabilityBadge entry={entry} readOnly={readOnly} locale={locale} compact />
            </div>
            {subtitle && (
              <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
            )}
            {/* `ml-auto` keeps stats and actions right-aligned on whichever
                line they land on; they wrap among themselves only when even
                a line of their own is too narrow. */}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2 min-w-0">
              {stats?.map((s, i) => (
                <div
                  key={i}
                  className="flex items-baseline gap-1 px-2 py-0.5 rounded border bg-muted/30"
                >
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </span>
                  <span className="text-xs font-semibold tabular-nums">{s.value}</span>
                </div>
              ))}
              {actions}
            </div>
          </div>
        </div>
      ) : (
        // List / index pages: keep the full hero. The type label IS the
        // page identity here so we earn the vertical space.
        <div className="px-6 pt-5 pb-4 border-b bg-background">
          {/* Breadcrumb */}
          {!embedded && (
            <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
              <Link to={metadataBase} className="hover:text-foreground">
                {t('engine.breadcrumb.allTypes', locale)}
              </Link>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground font-medium">{label}</span>
            </nav>
          )}

          {/* Title row */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold truncate">{label}</h1>
                <code className="text-xs font-mono text-muted-foreground">
                  {type}
                </code>
                {entry?.domain && (
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                    {translateMetadataDomain(entry.domain, locale)}
                  </Badge>
                )}
                <WritabilityBadge entry={entry} readOnly={readOnly} locale={locale} />
              </div>
              {subtitle && (
                <div className="text-sm text-muted-foreground mt-1">{subtitle}</div>
              )}
              {!subtitle && entry?.description && (
                <div className="text-sm text-muted-foreground mt-1 max-w-3xl">
                  {entry.description}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {stats?.map((s, i) => (
                <div
                  key={i}
                  className="flex flex-col items-end px-3 py-1 rounded border bg-muted/30 min-w-[64px]"
                >
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{s.value}</span>
                </div>
              ))}
              {actions}
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
