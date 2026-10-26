// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataResourceListPage — generic list of items for a metadata type
 * (Phase 3c).
 *
 * Reads `/meta/:type`, applies registry-driven columns + search +
 * source/overlay filters, and renders an ObjectGrid-like table.
 * Each row links to its EditPage at `./:name?type=…`.
 *
 * No virtualisation in MVP — metadata lists are typically < 200 items
 * per type, well under the threshold where it'd matter.
 */

import * as React from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Search, RefreshCw, AlertTriangle, Lock, Copy } from 'lucide-react';
import {
  Button,
  HorizontalOverflowBox,
  PINNED_RIGHT_SEAM_SHADOW_CLASSES,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@object-ui/components';
import { Input } from '@object-ui/components';
import { Badge } from '@object-ui/components';
import { Switch } from '@object-ui/components';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  buttonVariants,
} from '@object-ui/components';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { Empty, EmptyTitle, EmptyDescription, EmptyValue } from '@object-ui/components';
import { PageShell, WritabilityBadge } from './PageShell.js';
import { PageHeader } from '../../layout/PageHeader.js';
import { useInSetupApp } from '../../console/setupApp.js';
import { getIcon } from '../../utils/getIcon.js';
import { MetadataTypeActions } from './MetadataTypeActions.js';
import { CreatePackageDialog } from './PackagesPage.js';
import {
  useMetadataClient,
  useMetadataTypes,
  matchesQuery,
  type RichMetadataTypeEntry,
} from './useMetadata.js';
import {
  getMetadataResource,
  resolveResourceConfig,
} from './registry.js';
import { t, tFormat, translateMetadataType, useMetadataLocale } from './i18n.js';
import { buildPackageScopeOptions } from './package-scope.js';
import { ENVIRONMENT_SCOPE_QUERY, isEnvironmentScope, useWalledCatalogReadOnly } from './catalog-scope.js';
import {
  audienceAnchorsOf,
  hasCatalogActivation,
  isCatalogItemActive,
  readCatalogActivation,
  writeCatalogActivation,
  type CatalogActivation,
} from './catalog-activation.js';
import { countsCatalogHolders, readCatalogHolderCount, type CatalogHolderCount } from './catalog-holders.js';
import { useCanAuthorMetadata } from '../../hooks/useCanAuthorMetadata.js';
import { declarationOnlyAuthoredObject } from './sharing-rule-catalog.js';
import { resolveAffordance, type SchemaLike } from '@object-ui/core';
import { useAdapter, useMetadata } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { SharingRuleCloneDialog, type SharingRuleCloneDialogProps } from './SharingRuleCloneDialog.js';
import { postureHasOrgWall, useTenancyPosture } from '../../hooks/useTenancyPosture.js';

/**
 * objectui#12982 — the Clone dialog of a declaration-only catalog
 * (`sharing-rule-catalog.ts`), keyed by type and internal to this page, as
 * `ResourceEditPage`'s environment sections are.
 */
const DECLARATION_CLONE_DIALOGS: Readonly<Record<string, React.ComponentType<SharingRuleCloneDialogProps>>> = {
  sharing_rule: SharingRuleCloneDialog,
};

export interface MetadataResourceListPageProps {
  type?: string;
}

type ItemRow = {
  /** Raw row from server — may be wrapped in `{ item, source, … }`. */
  raw: any;
  /** Flattened item content for display. */
  item: Record<string, unknown>;
  /**
   * Provenance classification derived from `_packageId` tag:
   *   - 'artifact' = shipped by a real code package
   *   - 'runtime'  = authored at runtime (DB-only, no packageId or sentinel)
   *
   * Server may also pre-classify via a top-level `source` field
   * ('code' / 'overlay' / 'effective'); we honor that when present
   * and fall back to packageId-derived inference otherwise.
   */
  source: 'artifact' | 'runtime';
  /**
   * Load-time Zod validation result attached by the framework
   * (`_diagnostics` on getMetaItems items). Undefined for types
   * without a registered schema.
   */
  diagnostics?: {
    valid: boolean;
    errors?: Array<{ path: string; message: string; code?: string }>;
    warnings?: Array<{ path: string; message: string }>;
  };
};

/**
 * Derive provenance from item._packageId. The `loadMetaFromDb` path
 * tags objects with the synthetic packageId 'sys_metadata' (see
 * framework protocol.ts:3092); treat that sentinel as runtime-authored.
 */
function classifyProvenance(item: Record<string, unknown>, rawSource?: string): 'artifact' | 'runtime' {
  if (rawSource === 'overlay' || rawSource === 'runtime') return 'runtime';
  if (rawSource === 'code' || rawSource === 'artifact') return 'artifact';
  const pkg = item._packageId as string | undefined;
  if (!pkg || pkg === 'sys_metadata') return 'runtime';
  return 'artifact';
}

export function MetadataResourceListPage({ type: typeProp }: MetadataResourceListPageProps) {
  const params = useParams<{ appName?: string; type?: string }>();
  const type = typeProp ?? params.type ?? '';

  if (type === 'package') {
    const appName = params.appName ?? 'studio';
    return <Navigate to={`/apps/${appName}/component/developer/packages`} replace />;
  }

  // If a fully custom ListPage is registered, render it and bail.
  // Done before any other hooks so hook count stays stable across type
  // switches between custom and default list pages.
  const customConfig = getMetadataResource(type);
  if (customConfig?.ListPage) {
    const Custom = customConfig.ListPage;
    return <Custom type={type} />;
  }

  return <DefaultMetadataList type={type} appName={params.appName} />;
}

function DefaultMetadataList({ type, appName }: { type: string; appName?: string }) {
  const navigate = useNavigate();
  const client = useMetadataClient();
  const { entries: typesEntries } = useMetadataTypes(client);
  const entry: RichMetadataTypeEntry | undefined = typesEntries.find((t) => t.type === type);
  const config = resolveResourceConfig(type, entry);
  const listInclude = config.listInclude;

  const [items, setItems] = React.useState<ItemRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [sourceFilter, setSourceFilter] = React.useState<string>('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = React.useState(0);
  // objectui#7611 — the ENVIRONMENT scope (`?scope=environment`): the Setup
  // catalog. The list is the registry's whole list for the type, not one
  // project package's slice, and it is re-gated for Setup — see
  // `catalog-scope.ts`.
  const envScope = isEnvironmentScope(searchParams);
  const canAuthor = useCanAuthorMetadata();
  const posture = useTenancyPosture();
  // objectui#12606 — under the Setup app the page draws Setup's one page
  // header: no "All Metadata Types" breadcrumb, no stat tiles, the count in
  // the description. Read off the route's `:appName`; the same page anywhere
  // else (the directory, Studio's "Open in Setup" target) keeps its shell.
  const inSetup = useInSetupApp();
  // objectui#12183 — under a wall the security catalog is the platform
  // operator's: the server refuses this caller every write of the type,
  // whatever it holds (`catalog-scope.ts`). Not keyed on the scope: the server's
  // verdict has none, and the package door is refused the same way.
  const walled = useWalledCatalogReadOnly(type);
  const activation = envScope && hasCatalogActivation(type);
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'inactive'>('all');
  // The activation ledger's answer for the switch column, with the names the
  // door refuses to switch (`catalog-activation.ts`). `null` while unread,
  // `'error'` when the read was refused or failed, with the server's words for
  // why (objectui#13091) beside it.
  const [ledger, setLedger] = React.useState<CatalogLedger | 'error' | null>(null);
  const [ledgerRefusal, setLedgerRefusal] = React.useState<string | null>(null);
  const [switching, setSwitching] = React.useState<string | null>(null);
  const [switchError, setSwitchError] = React.useState<string | null>(null);
  // objectui#13338 — switching a permission set or a position OFF asks first,
  // naming how many users lose the access: the holder count, read from the
  // server when the confirm opens (`catalog-holders.ts`). Switching on asks
  // nothing. `holders` is `null` while the count is read.
  const [pendingOff, setPendingOff] = React.useState<{
    name: string;
    label: string;
    holders: CatalogHolderCount | { error: string } | null;
  } | null>(null);
  const adapter = useAdapter();
  const locale = useMetadataLocale();
  // objectui#12982 — a declaration-only catalog (declared sharing rules): the
  // environment scope lists declarations read-only, and the items an
  // environment authors are records of this object, edited on its own page.
  const authoredObject = envScope ? declarationOnlyAuthoredObject(type) : undefined;
  // Clone creates a record of the authored object, so it reads that write's
  // row of the affordance-to-grant map (`resolveAffordance` in
  // `@object-ui/core`), asked of the object with its schema as the server
  // serves it — that one object, read by name through `readObjectScope`, not
  // the whole object registry (objectui#12811). A caller without the create
  // grant is offered no Clone; the server decides the write either way.
  const perms = usePermissions();
  const metadataStore = useMetadata();
  // Read through a ref when the confirm opens: the store's context value is
  // rebuilt whenever any cached type settles (AGENTS.md #10).
  const metadataStoreRef = React.useRef(metadataStore);
  React.useEffect(() => {
    metadataStoreRef.current = metadataStore;
  });
  const authoredScope =
    authoredObject && metadataStore.readObjectScope
      ? metadataStore.readObjectScope({ names: [authoredObject] })
      : null;
  const canClone =
    !!authoredObject &&
    resolveAffordance('declarationClone', {
      objectSchema: ((authoredScope?.objects ?? []).find(
        (o) => (o as { name?: unknown } | null)?.name === authoredObject,
      ) ?? null) as SchemaLike | null,
      objectName: authoredObject,
      perms,
    }).allowed;
  const CloneDialog = authoredObject && canClone ? DECLARATION_CLONE_DIALOGS[type] : undefined;
  const [cloning, setCloning] = React.useState<Record<string, unknown> | null>(null);

  // Studio is scoped to a single *project* package at a time. Load the
  // installed packages and keep only project-scoped ones — anything not
  // tagged `system`/`cloud` (a missing scope counts as project). System
  // metadata therefore never leaks: the scope selector never offers a
  // system package and an unscoped view is not allowed.
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

  // Resolve the CURRENT APP's package so the list defaults to the scope the
  // admin is actually working in (e.g. opening Pages from the Showcase app
  // shows that app's pages, not an alphabetically-first empty template). The
  // route segment may be the app `name` or its package id, so match both.
  const [appPackage, setAppPackage] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    if (!appName) { setAppPackage(null); return; }
    (async () => {
      try {
        const apps = await client.list<any>('app');
        if (cancelled) return;
        const match = (apps ?? [])
          .map((raw) => (raw && typeof raw === 'object' && 'item' in raw ? (raw as any).item : raw))
          .find((a: any) => a?.name === appName || a?._packageId === appName);
        setAppPackage((match as any)?._packageId ?? null);
      } catch {
        if (!cancelled) setAppPackage(null);
      }
    })();
    return () => { cancelled = true; };
  }, [client, appName]);

  // Resolve the active package from the URL, validated against the project
  // package set. `null` while packages are still loading (fail closed).
  const urlPackage = searchParams.get('package');
  const activePackage = React.useMemo(() => {
    if (!projectPackages) return null;
    if (urlPackage && projectPackages.some((p) => p.id === urlPackage)) return urlPackage;
    if (projectPackages.length === 0) return null;
    // No valid URL package: prefer the CURRENT APP's package (the scope the
    // admin is working in) when it's a valid project package — this is what
    // makes "Pages" in the Showcase app default to Showcase's pages.
    if (appPackage && projectPackages.some((p) => p.id === appPackage)) return appPackage;
    // Otherwise prefer the project package that actually OWNS rows of this
    // metadata type, so the list never opens empty on an alphabetically-first
    // package that happens to own none. Falls back to the first package.
    const counts = new Map<string, number>();
    for (const row of items) {
      const pkg = (row.item as any)?._packageId;
      if (pkg && pkg !== 'sys_metadata') counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const p of projectPackages) {
      const n = counts.get(p.id) ?? 0;
      if (n > bestN) { best = p.id; bestN = n; }
    }
    return best ?? projectPackages[0]?.id ?? null;
  }, [projectPackages, urlPackage, items, appPackage]);

  // Repair `?package=` so the sidebar selector, deep-links and create/edit
  // navigation all agree on the active scope. Runs once packages resolve
  // and the URL holds no valid project package.
  React.useEffect(() => {
    // The environment scope lists every package's items: no package to repair.
    if (envScope) return;
    if (!projectPackages || projectPackages.length === 0) return;
    if (urlPackage && projectPackages.some((p) => p.id === urlPackage)) return;
    // If the current app's package is known we can repair immediately; otherwise
    // wait for rows so `activePackage` can resolve to the package that owns this
    // type (repairing to the alphabetical-first package before then would lock
    // the list onto an empty scope).
    const appPkgValid = !!(appPackage && projectPackages.some((p) => p.id === appPackage));
    if (!appPkgValid && items.length === 0) return;
    if (!activePackage) return;
    const next = new URLSearchParams(searchParams);
    next.set('package', activePackage);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPackages, urlPackage, items, activePackage, appPackage]);

  // Carry the active package into create/edit navigation as `?package=` so
  // the editor binds newly-saved rows to that software package.
  const pkgSuffix = envScope
    ? `?${ENVIRONMENT_SCOPE_QUERY}`
    : activePackage
      ? `?package=${encodeURIComponent(activePackage)}`
      : '';

  // ADR-0070 D3 — never start a create that would orphan the item. When a real
  // writable base exists, create into it (defaulting away from the Local/null
  // scope); when none exists yet, prompt to create a base first.
  const [showCreateBase, setShowCreateBase] = React.useState(false);
  const handleCreate = React.useCallback(() => {
    // An environment-authored item belongs to no package (ADR-0131 D3).
    if (envScope) {
      navigate(`./new?${ENVIRONMENT_SCOPE_QUERY}`);
      return;
    }
    const bases = projectPackages ?? [];
    if (projectPackages !== null && bases.length === 0) {
      setShowCreateBase(true);
      return;
    }
    if (bases.length > 0 && !activePackage) {
      navigate(`./new?package=${encodeURIComponent(bases[0].id)}`);
      return;
    }
    navigate(`./new${pkgSuffix}`);
  }, [projectPackages, activePackage, pkgSuffix, navigate, envScope]);

  // objectui#7611 — the activation state the switch column shows. Re-read on
  // the list's own refresh, never on an unrelated render. The anchors arrive
  // with the states, so no anchor is ever drawn as a live switch.
  React.useEffect(() => {
    if (!activation) {
      setLedger(null);
      setLedgerRefusal(null);
      return;
    }
    const controller = new AbortController();
    Promise.all([readCatalogActivation(type, controller.signal), audienceAnchorsOf(type)])
      .then(([states, anchors]) => {
        if (controller.signal.aborted) return;
        setLedger({ states, anchors });
        setLedgerRefusal(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLedger('error');
        setLedgerRefusal(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [activation, type, refreshKey]);

  const recordSwitched = React.useCallback((itemName: string, now: boolean) => {
    setLedger((prev) => {
      if (!prev || prev === 'error') return prev;
      const states = new Map(prev.states);
      states.set(itemName, now);
      return { ...prev, states };
    });
  }, []);

  // The item's label for the confirm and the toast, read through a ref so the
  // callbacks below do not re-key on every list load.
  const itemsRef = React.useRef<ItemRow[]>([]);
  const labelOf = React.useCallback((itemName: string): string => {
    const row = itemsRef.current.find((r) => String(r.item.name ?? '') === itemName);
    const label = row?.item.label;
    return typeof label === 'string' && label ? label : itemName;
  }, []);

  const writeActive = React.useCallback(
    async (itemName: string, enabled: boolean) => {
      setSwitching(itemName);
      setSwitchError(null);
      try {
        const now = await writeCatalogActivation(type, itemName, !enabled);
        recordSwitched(itemName, now);
        // objectui#13338 — a toast confirms the change either way.
        if (countsCatalogHolders(type)) {
          toast.success(
            tFormat(now ? 'engine.catalog.active.switchedOn' : 'engine.catalog.active.switchedOff', locale, {
              name: labelOf(itemName),
            }),
          );
        }
      } catch (err: any) {
        setSwitchError(err?.message ?? String(err));
      } finally {
        setSwitching(null);
      }
    },
    [type, recordSwitched, locale, labelOf],
  );

  // The holder-count read of the confirm now open; a newer open (or a close)
  // makes an older answer stale.
  const holderReadRef = React.useRef(0);
  const toggleActive = React.useCallback(
    (itemName: string, enabled: boolean) => {
      if (!enabled || !countsCatalogHolders(type)) {
        void writeActive(itemName, enabled);
        return;
      }
      const read = ++holderReadRef.current;
      setPendingOff({ name: itemName, label: labelOf(itemName), holders: null });
      readCatalogHolderCount(adapter, metadataStoreRef.current, type, itemName)
        .then((holders) => {
          if (holderReadRef.current !== read) return;
          setPendingOff((prev) => (prev && prev.name === itemName ? { ...prev, holders } : prev));
        })
        .catch((err: unknown) => {
          if (holderReadRef.current !== read) return;
          const error = err instanceof Error ? err.message : String(err);
          setPendingOff((prev) => (prev && prev.name === itemName ? { ...prev, holders: { error } } : prev));
        });
    },
    [type, adapter, writeActive, labelOf],
  );
  const closeConfirm = React.useCallback(() => {
    holderReadRef.current++;
    setPendingOff(null);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const list = await client.list<any>(type, listInclude ? { include: listInclude } : undefined);
        if (cancelled) return;
        const rows: ItemRow[] = (list ?? []).map((raw) => {
          const item = (raw && typeof raw === 'object' && 'item' in raw ? raw.item : raw) ?? {};
          // _diagnostics may live on the unwrapped item (default) or on the
          // outer envelope when callers reshape rows; check both.
          const diagnostics =
            (item as any)?._diagnostics ?? (raw as any)?._diagnostics ?? undefined;
          return {
            raw,
            item,
            source: classifyProvenance(item, raw?.source),
            diagnostics,
          };
        });
        itemsRef.current = rows;
        setItems(rows);
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, type, refreshKey, listInclude]);

  const searchableFields = config.searchableFields ?? ['name', 'label', 'description'];
  // Structural scope — every row this package could ever show for this
  // type, before the user's search box / source dropdown narrow it. Header
  // counts, the source filter, and the empty-state copy all key off this so
  // a package with zero items of a type reads as "暂无…条目", not "no match
  // for an (empty) query" just because *other* packages own rows of the
  // same type (server list() is not package-scoped; we scope client-side).
  const scopedItems = React.useMemo(
    () =>
      items.filter((row) => {
        // Per-type hide hook (e.g. `view` drops the bare aggregated
        // container the framework keeps for runtime dual-read).
        if (config.listFilter && !config.listFilter(row.item)) return false;
        // objectui#7611 — the environment scope is the whole registry list.
        if (envScope) return true;
        // Mandatory project-package scope: show nothing until a concrete
        // project package is active, then only rows tagged with it. The
        // 'sys_metadata' sentinel and untagged rows never match.
        if (!activePackage) return false;
        const pkg = (row.item as any)?._packageId;
        // Only rows tagged with the active writable base match. Untagged /
        // `sys_metadata`-provenance legacy rows have no scope of their own
        // (ADR-0070 D5 — the package-less "Local / Custom" scope is removed).
        return pkg === activePackage;
      }),
    [items, activePackage, config, envScope],
  );

  // User-driven filters (search query + source provenance) on top of scope.
  const filtered = scopedItems.filter((row) => {
    if (!matchesQuery(row.item, query, searchableFields)) return false;
    if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
    if (activation && statusFilter !== 'all') {
      // Only a KNOWN state filters: while the ledger is unread or unreadable,
      // no item is either active or inactive to this filter.
      if (!ledger || ledger === 'error') return false;
      if ((statusFilter === 'active') !== isCatalogItemActive(ledger.states, String(row.item.name ?? ''))) return false;
    }
    return true;
  });

  // Compute source + invalid counts for filter / header stats.
  const sourceCounts = React.useMemo(() => {
    const c = { all: scopedItems.length, artifact: 0, runtime: 0 };
    for (const r of scopedItems) {
      c[r.source]++;
    }
    return c;
  }, [scopedItems]);

  const invalidCount = React.useMemo(
    () => scopedItems.filter((r) => r.diagnostics && r.diagnostics.valid === false).length,
    [scopedItems],
  );

  // Items with warnings but no errors — softer, advisory tier. We
  // count rows (not warning instances) for consistency with `invalid`.
  const warnOnlyCount = React.useMemo(
    () =>
      scopedItems.filter(
        (r) =>
          r.diagnostics &&
          r.diagnostics.valid !== false &&
          (r.diagnostics.warnings?.length ?? 0) > 0,
      ).length,
    [scopedItems],
  );

  const columns = config.listColumns ?? defaultColumns(config.primaryKey ?? 'name');
  const typeLabel = translateMetadataType(type, locale, entry?.label ?? type);
  // The type offers SOME runtime write channel (the editors' type tier), and —
  // in the environment scope — the caller holds the capability the metadata
  // door requires. The server refuses either way; this is the half that says
  // so before the click (objectui#7611, the #22621 → A parity gate).
  const typeWritable = !!(entry?.allowEnvironmentOverlay || entry?.allowRuntimeCreate);
  // A declaration-only catalog is never authored here: its items are created
  // on the authored object's page.
  const canCreate = typeWritable && !walled && (!envScope || canAuthor) && !authoredObject;
  // The wall is the gate to NAME only where the type would otherwise admit a
  // write: a type with no runtime write channel is read-only for the operator
  // too, and its page says nothing about the wall.
  const walledDeciding = walled && typeWritable;
  // Packages load only for the package scope; the environment scope never
  // waits on them.
  const packagesPending = !envScope && projectPackages === null;

  // Localise default column labels — registered columns keep their
  // hand-authored labels (consumers may want bespoke wording).
  const localizeColumnLabel = (col: { key: string; label: string }) => {
    const tryKey = `engine.list.col.${col.key}`;
    const translated = t(tryKey, locale);
    return translated === tryKey ? col.label : translated;
  };

  const refresh = () => setRefreshKey((k) => k + 1);
  const createButton = canCreate && (
    <Button
      size="sm"
      variant={config.createFields ? 'default' : 'outline'}
      onClick={handleCreate}
      title={
        config.createFields
          ? tFormat('engine.list.createHint', locale, { type: typeLabel })
          : undefined
      }
    >
      <Plus className="h-4 w-4 mr-1" />
      {t('engine.list.create', locale)}
    </Button>
  );
  // Declarative type-level actions (GAP-1) scoped to the list toolbar.
  // Per-row (`list_item`) actions are not surfaced here yet — they need the
  // row's recordId from the grid.
  const typeActions = (
    <>
      <MetadataTypeActions entry={entry} location="list_toolbar" onAfter={refresh} />
      {authoredObject && (
        <Button asChild size="sm" variant="outline" data-testid="catalog-authored-object-link">
          <Link to={`/apps/${encodeURIComponent(appName ?? 'setup')}/${authoredObject}`}>
            {t(`engine.catalog.declaredOnly.authoredLink.${type}`, locale)}
          </Link>
        </Button>
      )}
    </>
  );

  // objectui#13091 — the row's controls pinned to the table's right edge: the
  // Clone column at `right-0`, at its fixed width, and the Active column just
  // left of it. The first pinned column draws the seam shadow.
  const pinned = activation || !!CloneDialog;
  const cloneCellPin = CloneDialog
    ? cn(PINNED_CELL_CLASSES, 'right-0 w-28 min-w-28', !activation && PINNED_SEAM_CLASSES)
    : undefined;
  const activeCellPin = activation
    ? cn(PINNED_CELL_CLASSES, CloneDialog ? 'right-28' : 'right-0', PINNED_SEAM_CLASSES)
    : undefined;

  const body = (
      <div className="p-6 space-y-4">
        <CreatePackageDialog
          open={showCreateBase}
          onOpenChange={setShowCreateBase}
          onCreated={(id) => navigate(`./new?package=${encodeURIComponent(id)}`)}
        />
        {/* Filter row */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className={cn('pl-8', inSetup && 'h-8')}
              placeholder={t('engine.list.search', locale)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            {/* Under Setup the source select is a filter chip (objectui#12606). */}
            <SelectTrigger
              className={inSetup ? 'h-8 w-auto gap-1.5 rounded-full px-3 text-xs' : 'w-[180px]'}
              data-testid="metadata-source-filter"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('engine.list.allSources', locale)} ({sourceCounts.all})</SelectItem>
              <SelectItem value="artifact">{t('engine.list.source.artifact', locale)} ({sourceCounts.artifact})</SelectItem>
              <SelectItem value="runtime">{t('engine.list.source.runtime', locale)} ({sourceCounts.runtime})</SelectItem>
            </SelectContent>
          </Select>
          {activation && (
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger
                className={inSetup ? 'h-8 w-auto gap-1.5 rounded-full px-3 text-xs' : 'w-[150px]'}
                data-testid="catalog-status-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('engine.catalog.status.all', locale)}</SelectItem>
                <SelectItem value="active">{t('engine.catalog.status.active', locale)}</SelectItem>
                <SelectItem value="inactive">{t('engine.catalog.status.inactive', locale)}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {/* objectui#7611 — the environment scope says WHY a caller cannot
            define here, in the posture's own terms (#22621 → A): under
            `single` the platform administrator defines and an organization
            administrator reads; under a wall the operator defines in Studio
            and tenants assign. objectui#12183 — and under a wall a tenant
            holding the capability is told the same thing, since the capability
            does not admit it there. */}
        {authoredObject && (
          <div
            data-testid="catalog-declared-only-hint"
            className="text-xs text-muted-foreground border rounded-md px-3 py-2.5 bg-muted/30 flex items-start gap-2"
          >
            <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{t(`engine.catalog.declaredOnly.hint.${type}`, locale)}</span>
          </div>
        )}
        {((envScope && !canAuthor && !authoredObject) || walledDeciding) && (
          <div
            data-testid="catalog-readonly-reason"
            className="text-xs text-amber-800 border border-amber-300/70 bg-amber-50/70 rounded-md px-3 py-2.5 dark:text-amber-200 dark:border-amber-700/40 dark:bg-amber-950/20 flex items-start gap-2"
          >
            <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {tFormat(
                postureHasOrgWall(posture) ? 'engine.catalog.readOnly.walled' : 'engine.catalog.readOnly.single',
                locale,
                { type: typeLabel },
              )}
            </span>
          </div>
        )}
        {authoredObject && !canAuthor && (
          <div
            data-testid="catalog-readonly-reason"
            className="text-xs text-amber-800 border border-amber-300/70 bg-amber-50/70 rounded-md px-3 py-2.5 dark:text-amber-200 dark:border-amber-700/40 dark:bg-amber-950/20 flex items-start gap-2"
          >
            <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{t('engine.catalog.declaredOnly.switchReadOnly', locale)}</span>
          </div>
        )}
        {cloning && CloneDialog && (
          <CloneDialog
            declaration={cloning}
            declaredNames={scopedItems.map((r) => String(r.item.name ?? ''))}
            sourceActive={
              ledger && ledger !== 'error' ? isCatalogItemActive(ledger.states, String(cloning.name ?? '')) : undefined
            }
            locale={locale}
            onClose={() => setCloning(null)}
            onSourceSwitched={recordSwitched}
          />
        )}
        {switchError && (
          <div className="text-xs text-destructive border border-destructive/30 rounded p-2 bg-destructive/5">
            {tFormat('engine.catalog.active.failed', locale, { message: switchError })}
          </div>
        )}
        <DeactivateConfirmDialog
          pending={pendingOff}
          locale={locale}
          onCancel={closeConfirm}
          onConfirm={(name) => {
            closeConfirm();
            void writeActive(name, true);
          }}
        />

        {/* Body */}
        {(loading || packagesPending) && (
          <div className="text-sm text-muted-foreground">{t('engine.edit.loading', locale)} {type}…</div>
        )}
        {error && (
          <div className="text-sm text-destructive border border-destructive/30 rounded p-3 bg-destructive/5">
            {error}
          </div>
        )}
        {!loading && !error && !envScope && projectPackages !== null && projectPackages.length === 0 && (
          <Empty>
            <EmptyTitle>No project packages installed</EmptyTitle>
            <EmptyDescription>
              Studio only shows metadata that belongs to a project software package.
              Install or create a project package to manage its metadata here.
            </EmptyDescription>
          </Empty>
        )}
        {!loading && !error && !packagesPending && (envScope || (projectPackages?.length ?? 0) > 0) && filtered.length === 0 && (
          <Empty>
            <EmptyTitle>
              {scopedItems.length === 0
                ? tFormat('engine.list.emptyType', locale, { type: typeLabel })
                : tFormat('engine.list.emptyQuery', locale, { query })}
            </EmptyTitle>
            <EmptyDescription>
              {config.emptyStateHint ??
                (canCreate
                  ? tFormat('engine.list.createHint', locale, { type: typeLabel })
                  : t('engine.list.readOnlyHint', locale))}
            </EmptyDescription>
            {scopedItems.length === 0 && canCreate && (
              <div className="mt-4">
                <Button onClick={handleCreate}>
                  <Plus className="h-4 w-4 mr-1" />
                  {t('engine.list.create', locale)}
                </Button>
              </div>
            )}
          </Empty>
        )}
        {!loading && filtered.length > 0 && (
          // objectui#13091 — a table wider than its box says so (the shared
          // overflow affordance, objectui#12708), and the row's controls (the
          // Active switch, Clone) stay pinned at its right edge, the seam
          // shadow on the first of them (objectui#12463).
          <HorizontalOverflowBox
            seam={pinned ? 'pinned' : 'edge'}
            outerClassName="border rounded-lg overflow-hidden"
            data-testid="metadata-list-scroller"
          >
            {/* Separated borders: Chrome paints a sticky cell of a collapsed-border
                table without covering the text scrolling beneath its edge
                (objectui#13091), so the row dividers are drawn on the cells. */}
            <table className="w-full text-sm border-separate border-spacing-0">
              {/* Under Setup the table reads as the console's record list
                  (objectui#12606): sentence-case headers, the grid's 36px
                  rows, middle-aligned cells. */}
              <thead
                className={
                  inSetup
                    ? 'bg-muted/30 text-xs text-muted-foreground'
                    : 'bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground'
                }
              >
                <tr className={HEAD_ROW_TINT}>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={cn('px-3 text-left font-medium', inSetup ? 'h-9 py-0' : 'py-2')}
                      style={c.width ? { width: c.width } : undefined}
                    >
                      {localizeColumnLabel(c)}
                    </th>
                  ))}
                  <th className={cn('px-3 text-right font-medium w-[80px]', inSetup ? 'h-9 py-0' : 'py-2')}>{t('engine.list.col.source', locale)}</th>
                  {activation && (
                    <th className={cn('px-3 text-left font-medium w-[90px]', inSetup ? 'h-9 py-0' : 'py-2', activeCellPin)}>
                      {t('engine.catalog.col.active', locale)}
                    </th>
                  )}
                  {CloneDialog && (
                    <th className={cn('px-3', inSetup ? 'h-9 py-0' : 'py-2', cloneCellPin)}>
                      <span className="sr-only">{t('engine.list.col.actions', locale)}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="[&>tr+tr>td]:border-t">
                {filtered.map((row, i) => {
                  const pk = config.primaryKey ?? 'name';
                  const name = String(row.item[pk] ?? `(unnamed-${i})`);
                  // ADR-0048 — link to this row's OWNING package so the editor
                  // resolves the right item even in the unscoped "all" list
                  // where two packages may ship the same name. Falls back to the
                  // workspace suffix for runtime/overlay-only rows (no real
                  // package, or the `sys_metadata` rehydration sentinel).
                  const rowPkg = (row.item as any)._packageId as string | undefined;
                  // The environment scope keeps its own scope instead: a
                  // catalog name has ONE holder per deployment (ADR-0131), so
                  // the editor resolves it by name alone.
                  const rowEditSuffix = envScope
                    ? pkgSuffix
                    : rowPkg && rowPkg !== 'sys_metadata'
                      ? `?package=${encodeURIComponent(rowPkg)}`
                      : pkgSuffix;
                  const invalid = row.diagnostics?.valid === false;
                  const errorList = row.diagnostics?.errors ?? [];
                  const warnList = (row.diagnostics as any)?.warnings ?? [];
                  const warnOnly = !invalid && warnList.length > 0;
                  const errorTitle = invalid
                    ? errorList
                        .slice(0, 3)
                        .map((e) => `${e.path || '(root)'}: ${e.message}`)
                        .join('\n') +
                      (errorList.length > 3 ? `\n+${errorList.length - 3} more` : '')
                    : warnOnly
                      ? warnList
                          .slice(0, 3)
                          .map((w: any) => `${w.path || '(root)'}: ${w.message}`)
                          .join('\n') +
                        (warnList.length > 3 ? `\n+${warnList.length - 3} more` : '')
                      : '';
                  const cellClass = inSetup ? 'h-9 px-3 py-1.5 align-middle' : 'px-3 py-2 align-top';
                  const sourceDesc =
                    row.source === 'artifact'
                      ? `${t('engine.list.source.artifactDesc', locale)}${row.item._packageId ? ` (${row.item._packageId})` : ''}`
                      : t('engine.list.source.runtimeDesc', locale);
                  const rowHref = `./${encodeURIComponent(name)}${rowEditSuffix}`;
                  return (
                    <tr
                      key={name + i}
                      data-testid={`metadata-row-${name}`}
                      onClick={(e) => openRowFromClick(e, () => navigate(rowHref))}
                      className={cn(
                        'cursor-pointer hover:bg-accent/50',
                        invalid ? 'bg-destructive/[0.04]' : warnOnly ? 'bg-amber-500/[0.05]' : '',
                        // The same fills, for the pinned cells to layer over
                        // their opaque background.
                        invalid ? INVALID_ROW_TINT : warnOnly ? WARN_ROW_TINT : '',
                        HOVER_ROW_TINT,
                      )}
                    >
                      {columns.map((c, ci) => {
                        const value = row.item[c.key];
                        const cell = c.render ? c.render(value, row.item) : defaultCell(value);
                        return (
                          <td key={c.key} className={cellClass}>
                            {ci === 0 ? (
                              <span className="inline-flex items-center gap-1.5">
                                {invalid && (
                                  <span
                                    className="inline-flex"
                                    aria-label={t('engine.list.invalidTitle', locale)}
                                    title={`${tFormat('engine.list.invalidCount', locale, { count: errorList.length })}\n${errorTitle}`}
                                  >
                                    <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                                  </span>
                                )}
                                {warnOnly && (
                                  <span
                                    className="inline-flex"
                                    aria-label={t('engine.list.warnTitle', locale)}
                                    title={`${tFormat('engine.list.warnCount', locale, { count: warnList.length })}\n${errorTitle}`}
                                  >
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                  </span>
                                )}
                                <Link
                                  to={rowHref}
                                  className="text-primary hover:underline font-mono"
                                >
                                  {cell}
                                </Link>
                              </span>
                            ) : (
                              cell
                            )}
                          </td>
                        );
                      })}
                      <td className={cn(cellClass, 'text-right')}>
                        {(row.item._lock as string | undefined) && row.item._lock !== 'none' && (
                          <span
                            className="inline-flex items-center mr-1 text-amber-600 dark:text-amber-400"
                            title={
                              (row.item._lockReason as string | undefined)
                              ?? `_lock=${String(row.item._lock)}`
                            }
                          >
                            <Lock className="h-3 w-3" />
                          </span>
                        )}
                        {inSetup ? (
                          // Under Setup the source is plain text with its
                          // explanation in a tooltip, not a chip on every row
                          // (objectui#12606).
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="cursor-help text-xs text-muted-foreground"
                                  data-testid="metadata-row-source"
                                >
                                  {t(`engine.list.source.${row.source}`, locale)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-xs text-xs">
                                {sourceDesc}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <Badge
                            variant="outline"
                            className={
                              'text-[10px] ' +
                              (row.source === 'artifact'
                                ? 'border-sky-500/50 text-sky-700 dark:text-sky-300'
                                : 'border-emerald-500/50 text-emerald-700 dark:text-emerald-300')
                            }
                            title={sourceDesc}
                          >
                            {t(`engine.list.source.${row.source}`, locale)}
                          </Badge>
                        )}
                      </td>
                      {activation && (
                        <td className={cn(cellClass, activeCellPin)}>
                          <CatalogActiveCell
                            itemName={name}
                            ledger={ledger}
                            refusal={ledgerRefusal}
                            canSwitch={canAuthor && !walled}
                            busy={switching === name}
                            locale={locale}
                            onToggle={toggleActive}
                          />
                        </td>
                      )}
                      {CloneDialog && (
                        <td className={cn(cellClass, 'text-right', cloneCellPin)}>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 max-w-[88px] px-2 text-xs"
                            onClick={() => setCloning(row.item)}
                            title={t('engine.sharingRule.clone.action', locale)}
                            data-testid={`catalog-clone-${name}`}
                          >
                            <Copy className="h-3.5 w-3.5 mr-1" />
                            <span className="truncate">{t('engine.sharingRule.clone.action', locale)}</span>
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </HorizontalOverflowBox>
        )}
      </div>
  );

  // The validation tiers stay counted where the stat tiles went: beside the
  // kind chip under Setup, as tiles elsewhere.
  const diagnosticStats = [
        ...(invalidCount > 0
          ? [
              {
                label: t('engine.list.invalid', locale),
                value: (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {invalidCount}
                  </span>
                ),
              },
            ]
          : []),
        ...(warnOnlyCount > 0
          ? [
              {
                label: t('engine.list.warnings', locale),
                value: (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {warnOnlyCount}
                  </span>
                ),
              },
            ]
          : []),
  ];

  if (inSetup) {
    const count = scopedItems.length;
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <PageHeader
          title={typeLabel}
          // `createElement`, not a JSX tag: the looked-up icon is a value
          // (the convention ObjectView set).
          icon={React.createElement(getIcon(config.iconName ?? 'layers'), { className: 'h-4 w-4' })}
          badge={
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <WritabilityBadge entry={entry} readOnly={!!authoredObject} locale={locale} />
              {diagnosticStats.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-xs" title={s.label}>
                  {s.value}
                </span>
              ))}
            </span>
          }
          subtitle={tFormat(count === 1 ? 'engine.list.itemCountOne' : 'engine.list.itemCount', locale, { count })}
          refresh={{ onRefresh: refresh, label: t('engine.list.refresh', locale), busy: loading }}
          actions={
            <>
              {typeActions}
              {createButton}
            </>
          }
          data-testid="metadata-list-setup-header"
        />
        <div className="flex-1 overflow-auto">{body}</div>
      </div>
    );
  }

  return (
    <PageShell
      entry={entry ?? { type, label: type }}
      stats={[
        { label: t('engine.list.items', locale), value: scopedItems.length },
        { label: t('engine.list.filtered', locale), value: filtered.length },
        ...diagnosticStats,
      ]}
      actions={
        <>
          {typeActions}
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            title={t('engine.list.refresh', locale)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {createButton}
        </>
      }
    >
      {body}
    </PageShell>
  );
}

/**
 * objectui#13091 — a cell pinned to the right edge of the list's overflow box.
 * It paints an opaque background, because the other columns scroll beneath
 * it, and layers its row's fill (`--os-row-tint`, the convention `data-table`
 * keeps for its sticky cells) over it, so a pinned cell reads as part of its
 * row. The Clone column is the fixed `w-28` the Active column's `right-28`
 * offset counts on; its button truncates its label to stay inside it.
 *
 * Complete literals: Tailwind v4 builds only from scanned source text.
 */
const PINNED_CELL_CLASSES =
  'sticky z-10 bg-background bg-[image:linear-gradient(var(--os-row-tint,transparent),var(--os-row-tint,transparent))]';
const PINNED_SEAM_CLASSES = `border-l border-border ${PINNED_RIGHT_SEAM_SHADOW_CLASSES}`;
const HEAD_ROW_TINT = '[--os-row-tint:color-mix(in_oklab,var(--color-muted)_30%,transparent)]';
const INVALID_ROW_TINT = '[--os-row-tint:color-mix(in_oklab,var(--color-destructive)_4%,transparent)]';
const WARN_ROW_TINT = '[--os-row-tint:color-mix(in_oklab,var(--color-amber-500)_5%,transparent)]';
const HOVER_ROW_TINT = 'hover:[--os-row-tint:color-mix(in_oklab,var(--color-accent)_50%,transparent)]';

/**
 * objectui#13338 — the confirm a permission set's or a position's switch asks
 * before it switches the item OFF, naming how many users lose the access. The
 * count is the server's, read when the confirm opens; while it is read the
 * confirm says so and its Deactivate waits. A count that could not be read is
 * said as such (never as "0 users"), and the admin may still go ahead: the
 * confirm informs, it does not gate. Cancel leaves the item on.
 */
function DeactivateConfirmDialog({
  pending,
  locale,
  onCancel,
  onConfirm,
}: {
  pending: { name: string; label: string; holders: CatalogHolderCount | { error: string } | null } | null;
  locale: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const holders = pending?.holders ?? null;
  let impact: string;
  if (holders === null) impact = t('engine.catalog.deactivate.counting', locale);
  else if ('error' in holders) impact = tFormat('engine.catalog.deactivate.countFailed', locale, { message: holders.error });
  else if (holders.everyone) impact = t('engine.catalog.deactivate.everyone', locale);
  else if (holders.truncated) impact = tFormat('engine.catalog.deactivate.holdersAtLeast', locale, { count: holders.count });
  else if (holders.count === 1) impact = t('engine.catalog.deactivate.holdersOne', locale);
  else impact = tFormat('engine.catalog.deactivate.holders', locale, { count: holders.count });
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent data-testid="catalog-deactivate-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {tFormat('engine.catalog.deactivate.title', locale, { name: pending?.label ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription data-testid="catalog-deactivate-impact">{impact}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="catalog-deactivate-cancel">{t('engine.cancel', locale)}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            disabled={holders === null}
            data-testid="catalog-deactivate-confirm"
            onClick={() => {
              if (pending) onConfirm(pending.name);
            }}
          >
            {t('engine.catalog.deactivate.confirm', locale)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The activation ledger's states for a type, and the names its door refuses. */
interface CatalogLedger {
  states: CatalogActivation;
  anchors: ReadonlySet<string>;
}

/**
 * objectui#7611 — one item's active switch in the environment scope, showing
 * the activation ledger's state (see `catalog-activation.ts`). Its non-switch
 * states are each said, never rendered as a guessed "on": the state is still
 * loading, or the read failed (said in words, with the server's reason). An audience anchor shows its state on a
 * disabled switch with the reason, because the door refuses to switch it.
 */
function CatalogActiveCell({
  itemName,
  ledger,
  refusal,
  canSwitch,
  busy,
  locale,
  onToggle,
}: {
  itemName: string;
  ledger: CatalogLedger | 'error' | null;
  /** Why the read failed: the server's refusal, as `actionErrorDetail` read it. */
  refusal: string | null;
  canSwitch: boolean;
  busy: boolean;
  locale: string;
  onToggle: (itemName: string, enabled: boolean) => void;
}) {
  if (ledger === null) return <span className="text-xs text-muted-foreground">…</span>;
  if (ledger === 'error') {
    // objectui#13091 — said in plain words, never a bare "?"; the server's
    // own sentence for why rides in the title.
    const why = [t('engine.catalog.active.unknown', locale), refusal].filter(Boolean).join(' ');
    return (
      <span
        className="text-xs text-muted-foreground whitespace-nowrap"
        title={why}
        data-testid={`catalog-active-unreadable-${itemName}`}
      >
        {t('engine.catalog.active.notVisible', locale)}
      </span>
    );
  }
  const enabled = isCatalogItemActive(ledger.states, itemName);
  const anchor = ledger.anchors.has(itemName);
  // A switch the caller cannot use states the state, and offers no click; the
  // page's read-only reason says why.
  const label = anchor
    ? t('engine.catalog.active.anchor', locale)
    : canSwitch
      ? t(enabled ? 'engine.catalog.active.on' : 'engine.catalog.active.off', locale)
      : t(enabled ? 'engine.catalog.status.active' : 'engine.catalog.status.inactive', locale);
  return (
    <span className="inline-flex" title={label}>
      <Switch
        checked={enabled}
        disabled={anchor || !canSwitch || busy}
        onCheckedChange={() => onToggle(itemName, enabled)}
        aria-label={label}
        data-testid={`catalog-active-${itemName}`}
      />
    </span>
  );
}

/**
 * The whole row opens its item (objectstack#25333), the way a record list's
 * row does. The first cell keeps its link, which is what a keyboard, a screen
 * reader and a modified click (new tab) use; this handler is the pointer's
 * larger target and stands aside for everything the row already does:
 *
 *  - a click on a control in the row (the link itself, the Active switch,
 *    Clone, a tooltip trigger) is that control's;
 *  - a click that reached the row through a React portal (a dialog a row
 *    control opened) did not happen on the row;
 *  - a modified or non-primary click, and a click that ends a text selection,
 *    are the browser's.
 */
export function openRowFromClick(e: React.MouseEvent<HTMLElement>, open: () => void): void {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const target = e.target as Node | null;
  if (!target || !e.currentTarget.contains(target)) return;
  const el = target instanceof Element ? target : target.parentElement;
  if (el?.closest(ROW_OWN_CONTROLS)) return;
  const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return;
  open();
}

const ROW_OWN_CONTROLS =
  'a,button,input,select,textarea,label,summary,[role="button"],[role="switch"],[role="checkbox"],[role="menuitem"],[role="link"],[contenteditable="true"]';

function defaultColumns(primaryKey: string): NonNullable<import('./registry.js').MetadataResourceConfig['listColumns']> {
  return [
    { key: primaryKey, label: primaryKey, width: '30%' },
    { key: 'label', label: 'Label', width: '30%' },
    { key: 'description', label: 'Description' },
  ];
}

function defaultCell(value: unknown): React.ReactNode {
  if (value == null || value === '') {
    return <EmptyValue />;
  }
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'object') {
    try {
      return (
        <code className="font-mono text-xs">
          {JSON.stringify(value).slice(0, 60)}
        </code>
      );
    } catch {
      return String(value);
    }
  }
  return String(value);
}
