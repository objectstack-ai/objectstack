// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared hooks + types for the metadata-admin engine (Phase 3c).
 *
 * Centralises the MetadataClient creation and the rich `/meta/types`
 * row shape so every page reads from the same source of truth.
 *
 * Why a tiny barrel?
 *   • DirectoryPage, ListPage, EditPage, HistoryPage and QuickFind
 *     all need (client, typesRegistry). Letting each page re-fetch
 *     would be wasteful and produce flickering badges.
 *   • The hook caches the client per `baseUrl + environmentId` pair
 *     so `client.withEnvironment(...)` swaps without remounting
 *     consumers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type MetadataClient, type MetadataDiagnosticsSummary, type MetadataDiagnosticsEntry, type MetadataSaveAdvisoryEvent } from '@object-ui/data-objectstack';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAdapter } from '@object-ui/react';
import { toast } from 'sonner';
import { usePreviewDrafts } from '../../preview/PreviewModeContext.js';
import { createConsoleMetadataClient } from './metadataClientFactory.js';
import { dropPublishedViewList, installViewListDrop } from './viewListDrop.js';
import { emitSaveAdvisories, type TranslateFn } from '../../providers/saveAdvisoryToast.js';
import type { FormViewSpec } from './form-spec.js';

/**
 * A declarative **type-level** action surfaced on a metadata type by the
 * framework's `/meta/types` endpoint (spec `ActionSchema`). Mirrors how a
 * business object carries `actions`, but scoped to the metadata type itself
 * (e.g. datasource → "Test connection"). The metadata-admin engine renders
 * these with the same button mechanism objects use — see `MetadataTypeActions`.
 */
export interface MetadataTypeAction {
  /** Machine name (lowercase snake_case) — stable key. */
  name: string;
  /** Display label (plain string; framework already localised it). */
  label?: string;
  /** Interaction type. Only `'api'` is wired in the engine today. */
  type?: string;
  /**
   * URL / endpoint. Supports `${ctx.X}` and `${param.X}` interpolation —
   * the engine resolves `${ctx.recordId}` to the current item name.
   */
  target?: string;
  /** HTTP method for `type:'api'` (defaults to POST). */
  method?: string;
  /** Lucide icon name. */
  icon?: string;
  /** Button visual variant. */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
  /** Locations where this action is visible (list_toolbar, record_header, …). */
  locations?: string[];
  /** Confirmation prompt shown before execution. */
  confirmText?: string;
  /** Reload the view after a successful run. */
  refreshAfter?: boolean;
  /**
   * Inputs. Either an array of ActionParam descriptors (collected from the user
   * in a dialog before running — same as business-object actions), or a static
   * key→value bag forwarded as the request body.
   */
  params?: Record<string, unknown> | unknown[];
  /** Success toast message (when no resultDialog). */
  successMessage?: string;
  /** Error toast prefix shown when the action fails. */
  errorMessage?: string;
  /** Render the API response in a result dialog (spec Action.resultDialog). */
  resultDialog?: Record<string, unknown>;
}

export interface RichMetadataTypeEntry {
  type: string;
  label?: string;
  description?: string;
  domain?: string;
  /**
   * May an environment overlay an item of this type that a package ships?
   * The server's `GET /meta/types` `entries[].allowEnvironmentOverlay`, the
   * write gate for a packaged item (ADR-0131 D6). objectstack#22340 renamed
   * the wire field from its per-org spelling; this is the only name read, with
   * no fallback to the old one (objectui#12141).
   */
  allowEnvironmentOverlay?: boolean;
  /** Declarative type-level actions (GAP-1). Rendered by `MetadataTypeActions`. */
  actions?: MetadataTypeAction[];
  /**
   * Two-tier model (PR-10d.7): brand-new items of this type can be
   * authored at runtime even when `allowEnvironmentOverlay` is false. UI
   * affordances ("+ New", Save, Delete on DB-only items) should
   * activate when either flag is true.
   */
  allowRuntimeCreate?: boolean;
  /**
   * 'registry' = ADR opt-in; 'env' = elevated by the `OS_METADATA_WRITABLE`
   * env var, which opens the type's items no package ships and never an item
   * a package ships (ADR-0131 D6).
   */
  overrideSource?: 'registry' | 'env';
  supportsOverlay?: boolean;
  loadOrder?: number;
  /** JSONSchema for the type's item shape (Phase 3a addition). */
  schema?: Record<string, unknown>;
  /**
   * Canonical FormView layout for the type's editor (Phase 3c+).
   *
   * Typed as the authoring {@link FormViewSpec} rather than an untyped record
   * handed on with `as any` (objectui#8725). This is a TYPE on a server
   * document that is deserialised without validation, not a check of it. Known
   * gaps between the spec's parsed `FormView` and this type (measured on
   * objectui#8725's PR, not re-derived here): the spec admits its `I18nLabel`
   * locale map on section and field `label` and on `placeholder` / `helpText`,
   * writes predicates as `ExpressionInput` rather than `VisibilityPredicate`,
   * types `colSpan` and `options` wider, and parses field rows with keys
   * `FormFieldSpec` does not declare (`span`, `keyField`). What `SchemaForm`
   * itself now guarantees is narrower: it resolves a `{ group }` section and
   * refuses one with no member source instead of assuming `fields`.
   */
  form?: FormViewSpec;
  /** UI hints (icon, color, etc.) the framework may include. */
  ui?: Record<string, unknown>;
}

/**
 * Use a single MetadataClient for the whole admin engine.
 *
 * Construction (base-URL resolution + the authenticated fetch that carries the
 * Bearer token to `/api/v1/meta/*`) lives in `createConsoleMetadataClient` so
 * every console surface shares one authenticated client — see
 * `metadataClientFactory.ts`. The hook caches per `baseUrl + environmentId +
 * previewDrafts` so `client.withEnvironment(...)` swaps without remounting.
 */
export function useMetadataClient(environmentId?: string): MetadataClient {
  // ADR-0037: inside a draft-preview tree (?preview=draft), reads overlay
  // pending drafts on the active registry. Writes are unaffected.
  const previewDrafts = usePreviewDrafts();

  // #4133 — the runtime authoring gate's advisory findings, rendered ONCE for
  // every save call site in the app.
  //
  // This hook is why the wiring belongs here rather than at the ~20 places
  // that call `client.save(...)`: every app-shell write path takes its client
  // from `useMetadataClient` (ResourceEditPage, StudioDesignSurface,
  // EmbeddedItemEditor, DatasourceResourcePage, ObjectHooksPanel, …), so one
  // sink here covers all of them and any future one for free. The factory
  // below stays render-free; this is the layer that has React context, which
  // is what the translation needs.
  //
  // `t` is read through a ref so a locale change does not re-mint the client
  // (which would remount every consumer) while the toast still renders in the
  // CURRENT language — the same shape `AdapterProvider` uses for its sibling
  // write-warning channel.
  const { t } = useObjectTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const onSaveAdvisory = useCallback((ev: MetadataSaveAdvisoryEvent) => {
    emitSaveAdvisories(ev, tRef.current as TranslateFn, toast);
  }, []);

  // objectui#13057 — the adapter answers its view-list readers from the list
  // it stored, and this client writes views over a transport the adapter never
  // sees. Each write of this client that can change a published view drops
  // that list (see `viewListDrop.ts`), here for the same reason the advisory
  // sink is here: every app-shell write path takes its client from this hook.
  // The adapter is read through a ref, as `t` is, so an adapter swap does not
  // re-mint the client and a write always drops from the current adapter.
  const adapter = useAdapter();
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  return useMemo(
    () =>
      installViewListDrop(createConsoleMetadataClient({ previewDrafts, environmentId, onSaveAdvisory }), () => {
        try {
          dropPublishedViewList(adapterRef.current);
        } catch {
          /* a drop must never turn a settled write into a thrown error */
        }
      }),
    [environmentId, previewDrafts, onSaveAdvisory],
  );
}

/**
 * Drop camelCase aliases when the registry also exposes a snake_case
 * sibling. The framework's `/meta/types` endpoint surfaces both forms
 * for some 7.1 system types (e.g. `analytics_cube` + `analyticsCube`,
 * `sharing_rule` + `sharingRule`) and we don't want the directory to
 * render the same logical type twice. Keep the snake_case row because
 * it matches our `TYPE_LABELS_*` keys and the framework's preferred
 * file naming convention.
 */
function dedupeCamelAliases(list: RichMetadataTypeEntry[]): RichMetadataTypeEntry[] {
  const have = new Set(list.map((e) => e.type));
  return list.filter((e) => {
    if (!/[A-Z]/.test(e.type)) return true;
    const snake = e.type.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return !(snake !== e.type && have.has(snake));
  });
}

/**
 * Fetch and cache the rich `/meta/types` registry response. Most pages
 * only need it once per session, so we memoise per (client) instance.
 */
export function useMetadataTypes(client: MetadataClient): {
  loading: boolean;
  error: string | null;
  entries: RichMetadataTypeEntry[];
} {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<RichMetadataTypeEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const result = await client.listTypes();
        let list: RichMetadataTypeEntry[];
        if (Array.isArray(result)) {
          list = (result as any[]).map((t) =>
            typeof t === 'string' ? { type: t } : (t as RichMetadataTypeEntry),
          );
        } else {
          const rich = (result as any)?.entries;
          if (Array.isArray(rich) && rich.length > 0) {
            list = rich;
          } else {
            const names = (result as any)?.types ?? [];
            list = names.map((t: string) => ({ type: t }));
          }
        }
        if (!cancelled) {
          setEntries(dedupeCamelAliases(list));
          setLoading(false);
        }
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
  }, [client]);

  return { loading, error, entries };
}

/**
 * Build a stable lookup map by type id from the entries array. Most
 * pages need O(1) access to "what's the label / writable status for
 * type X?".
 */
export function useTypesIndex(entries: RichMetadataTypeEntry[]): Record<string, RichMetadataTypeEntry> {
  return useMemo(() => {
    const idx: Record<string, RichMetadataTypeEntry> = {};
    for (const e of entries) idx[e.type] = e;
    return idx;
  }, [entries]);
}

/** Free-text filter helper used by list pages + QuickFind. */
export function matchesQuery(
  item: Record<string, unknown>,
  query: string,
  fields: string[] = ['name', 'label', 'description'],
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  for (const f of fields) {
    const v = item[f];
    if (typeof v === 'string' && v.toLowerCase().includes(q)) return true;
  }
  return false;
}

/**
 * Fetch the cross-type `/meta/diagnostics` sweep once and expose
 * both the raw entry list and a per-type aggregate (used by the
 * directory page tiles + the governance overview page).
 *
 * `severity` defaults to `'error'` — pass `'warning'` to include
 * warning-only entries in the count.
 *
 * `packageId` (optional) scopes the whole sweep to a single software
 * package: the server then reports per-package counts/packages, so tile
 * numbers match the scoped list pages. Omit for a global sweep.
 */
export function useGlobalDiagnostics(
  client: MetadataClient,
  severity: 'error' | 'warning' = 'error',
  packageId?: string,
): {
  loading: boolean;
  error: string | null;
  summary: MetadataDiagnosticsSummary;
  byType: Record<string, number>;
  /**
   * Per-type warning-only count. Only populated when `severity` is
   * `'warning'` (server omits warnings when severity is `'error'`).
   */
  warnByType: Record<string, number>;
  /** Per-type item count (from server-side sweep). Empty on older servers. */
  countsByType: Record<string, number>;
  /** Per-type *locked* item count (where `_lock` ≠ `none`). Empty on older servers. */
  lockedByType: Record<string, number>;
  /** Per-type list of contributing packages. Empty on older servers. */
  packagesByType: Record<string, string[]>;
  /** Sorted, deduped union of all packages seen across all types. */
  allPackages: string[];
  reload: () => void;
} {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MetadataDiagnosticsSummary>({
    entries: [],
    total: 0,
    scannedTypes: 0,
    scannedItems: 0,
    stats: {},
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await client.diagnostics(
          packageId ? { severity, packageId } : { severity },
        );
        if (cancelled) return;
        setSummary(res);
        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        // Older servers without /meta/diagnostics: surface as empty,
        // not as a fatal error — the directory page should still load.
        setError(err?.message ?? String(err));
        setSummary({ entries: [], total: 0, scannedTypes: 0, scannedItems: 0, stats: {} });
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, severity, packageId, tick]);

  const byType = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of summary.entries) {
      // Only count entries that actually have errors — when severity is
      // 'warning' the server returns BOTH error and warning-only rows
      // in the same list, and we want a strict error count here so
      // headline numbers stay consistent across severity modes.
      if ((e.diagnostics?.errors?.length ?? 0) > 0) {
        c[e.type] = (c[e.type] ?? 0) + 1;
      }
    }
    return c;
  }, [summary]);

  const warnByType = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of summary.entries) {
      const errs = e.diagnostics?.errors?.length ?? 0;
      const warns = e.diagnostics?.warnings?.length ?? 0;
      // "Warn-only" = no errors, ≥1 warning. Items with errors are
      // already counted in `byType` and the louder tier dominates the
      // UI badge — surfacing them under both would be noisy.
      if (errs === 0 && warns > 0) {
        c[e.type] = (c[e.type] ?? 0) + 1;
      }
    }
    return c;
  }, [summary]);

  const countsByType = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [t, s] of Object.entries(summary.stats ?? {})) c[t] = s.count;
    return c;
  }, [summary]);

  const lockedByType = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [t, s] of Object.entries(summary.stats ?? {})) {
      if (typeof (s as any).locked === 'number' && (s as any).locked > 0) {
        c[t] = (s as any).locked;
      }
    }
    return c;
  }, [summary]);

  const packagesByType = useMemo(() => {
    const c: Record<string, string[]> = {};
    for (const [t, s] of Object.entries(summary.stats ?? {})) c[t] = s.packages ?? [];
    return c;
  }, [summary]);

  const allPackages = useMemo(() => {
    const set = new Set<string>();
    for (const s of Object.values(summary.stats ?? {})) {
      for (const p of s.packages ?? []) set.add(p);
    }
    return [...set].sort();
  }, [summary]);

  return {
    loading,
    error,
    summary,
    byType,
    warnByType,
    countsByType,
    lockedByType,
    packagesByType,
    allPackages,
    reload: () => setTick((n) => n + 1),
  };
}

/**
 * Re-export so consumers can type their callbacks without reaching
 * into the data-objectstack package directly.
 */
export type { MetadataDiagnosticsEntry, MetadataDiagnosticsSummary };
