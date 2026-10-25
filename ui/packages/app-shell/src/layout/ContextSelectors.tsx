// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AppContextSelectors — renders the app-level "scope" dropdowns declared
 * in `App.contextSelectors` (e.g. the Studio package filter) and exposes
 * their current values so the sidebar can feed them into
 * `NavigationRenderer`'s `templateContext.contextValues`.
 *
 * Each selector's value is published under its `id` and referenced by
 * nav items as `{<id>}` (e.g. `{active_package}`), exactly like the
 * built-in `{current_user_id}` / `{current_org_id}` template vars.
 * Selecting an option therefore transparently scopes every child nav
 * item — no per-item wiring required.
 *
 * Where the active value LIVES is the author's choice, declared per selector by
 * `persist` (`AppContextSelectorSchema`, default `'query'`) and honoured here
 * as exactly ONE medium per value — the spec's own words are "Persist
 * selection via URL query, sessionStorage, or not at all":
 *
 *   - `'query'`   → the URL query string only, under a key derived per selector
 *                   by {@link contextSelectorQueryKey} (see that helper for the
 *                   one grandfathered key, `active_package` → `?package=`, and
 *                   its sunset);
 *   - `'session'` → `sessionStorage` only, never the URL;
 *   - `'none'`    → neither; the pick lives in memory for this mount only.
 *
 * The media are exclusive on BOTH sides: a `'session'` selector is never read
 * back off the query string, and a `'query'` selector is never read back out of
 * storage. Mirroring every pick into both stores is exactly what made
 * `'session'` and `'query'` indistinguishable and let `'none'` persist anyway
 * (objectstack#5994). A selector that wants URL reflection *and* a remembered
 * fallback is asking for a new `persist` value in the spec — not for this
 * renderer to write a second store the author never declared.
 *
 * @module
 */

import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { getIcon } from '../utils/getIcon.js';
import { resolveKeyedI18nLabel } from '../utils/index.js';

export interface ContextSelectorFilter {
  key: string;
  op?: 'eq' | 'ne' | 'in' | 'nin';
  value: string | string[];
}

export interface ContextSelectorDef {
  id: string;
  label?: unknown;
  icon?: string;
  optionsSource: { endpoint: string; valueKey?: string; labelKey?: string; filter?: ContextSelectorFilter[] };
  allValue?: string;
  persist?: 'query' | 'session' | 'none';
}

interface Option { value: string; label: string }

const ALL_SENTINEL = '__all__';

/** Selector id used by the built-in Studio app's package scope. */
export const STUDIO_PACKAGE_SELECTOR_ID = 'active_package';

/**
 * URL scope keys that shipped BEFORE the key was derived per selector
 * (objectui#3500). Grandfathered by selector id, read and write alike.
 *
 * Exactly one entry, and it must stay that way: Studio's `active_package`
 * selector keeps owning `?package=`. That key is a live contract with three
 * parties this file does not own —
 *
 *  1. bookmarked / shared Studio URLs already carrying `?package=…`;
 *  2. the Studio surfaces that read `?package` straight off the query string
 *     (`DirectoryPage`, `ResourceListPage`, `ResourceEditPage` ×2,
 *     `AiChatPage`);
 *  3. Studio's own nav metadata in `@objectstack/platform-objects`, which
 *     declares `params: { package: '{active_package}' }` on ~15 nav items —
 *     i.e. the destination query key is chosen by the APP metadata, not by
 *     this renderer, and renaming here alone would desync the two halves.
 *
 * So this is a migration, not a rename: the pre-existing selector keeps its
 * key, while every NEWLY declared selector gets `?<id>=` from day one — which
 * is the whole point of the fix (a second selector no longer mirrors the
 * first). Do not add entries here; a new selector that "wants" a shorter key
 * is asking for a spec-side `queryKey`, not a renderer-side alias.
 *
 * Sunset: delete the entry (and this table) once either
 *  (a) `AppContextSelectorSchema` gains an explicit query-key field so the app
 *      author declares it, or
 *  (b) Studio's nav metadata and the reader surfaces above move to
 *      `?active_package=`,
 * at which point the plain `id` derivation needs no exception.
 */
// A Map, not an object literal: selector ids are snake_case identifiers, and
// `constructor` / `valueOf` are legal snake_case — an object lookup would walk
// the prototype and hand back a function as the "query key".
const LEGACY_SCOPE_QUERY_KEYS: ReadonlyMap<string, string> = new Map([
  [STUDIO_PACKAGE_SELECTOR_ID, 'package'],
]);

/**
 * The URL query key that carries a context selector's active value.
 *
 * Derived from the selector's `id`, so each selector owns an independent
 * key — `AppContextSelectorSchema` promises the selected value is exposed
 * per `id`, and a shared key made every declared selector mirror the first.
 */
export function contextSelectorQueryKey(selectorId: string): string {
  return LEGACY_SCOPE_QUERY_KEYS.get(selectorId) ?? selectorId;
}

/** The persistence media `AppContextSelectorSchema.persist` can name. */
type PersistMode = NonNullable<ContextSelectorDef['persist']>;

/**
 * The selector's declared persistence medium.
 *
 * `persist` carries `.default('query')` in the spec, so an omitted key IS a
 * declaration of `'query'` — resolving it here honours the spec's default, it
 * does not tolerate under-specified metadata.
 */
function persistMode(sel: ContextSelectorDef): PersistMode {
  return sel.persist ?? 'query';
}

/** sessionStorage key holding a `persist: 'session'` selector's active value. */
function sessionScopeKey(appName: string, selectorId: string): string {
  return `objectui-ctx-${appName}-${selectorId}`;
}

/**
 * Active values of the `persist: 'session'` selectors, read back from storage.
 *
 * Only `'session'` selectors are read. `'query'` lives in the URL and `'none'`
 * must not survive at all, so an `objectui-ctx-*` entry left behind by an older
 * build — which mirrored EVERY selector into storage — is ignored rather than
 * resurrected under a value that no longer names storage as its medium.
 */
function readSessionScopes(
  appName: string,
  list: ContextSelectorDef[],
): Record<string, string> {
  const seed: Record<string, string> = {};
  for (const sel of list) {
    if (persistMode(sel) !== 'session') continue;
    try {
      const saved = sessionStorage.getItem(sessionScopeKey(appName, sel.id));
      if (saved) seed[sel.id] = saved;
    } catch { /* storage disabled */ }
  }
  return seed;
}

/** Read a (possibly dotted) property path off a row, e.g. `manifest.id`. */
function getByPath(row: any, key: string): unknown {
  if (!key) return undefined;
  return key.split('.').reduce((o: any, k) => (o == null ? o : o[k]), row);
}

/** Tolerate the common REST envelope shapes used across the platform. */
function extractRows(json: any): any[] {
  if (Array.isArray(json)) return json;
  const d = json?.data ?? json;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.packages)) return d.packages;
  if (Array.isArray(d?.items)) return d.items;
  if (Array.isArray(json?.items)) return json.items;
  return [];
}

/** Apply a selector's `filter` predicates (AND) to a fetched row. */
function rowPasses(row: any, filters: ContextSelectorFilter[] | undefined): boolean {
  if (!filters || filters.length === 0) return true;
  for (const f of filters) {
    const actual = getByPath(row, f.key);
    const op = f.op ?? 'eq';
    const list = Array.isArray(f.value) ? f.value : [f.value];
    switch (op) {
      case 'eq': if (actual !== f.value) return false; break;
      case 'ne': if (actual === f.value) return false; break;
      // `in`/`nin` treat a missing value as "not in the set", which keeps
      // untagged rows visible under `nin` (e.g. a package whose manifest
      // omits `scope` defaults to project and should remain selectable).
      case 'in': if (!list.includes(actual as string)) return false; break;
      case 'nin': if (list.includes(actual as string)) return false; break;
    }
  }
  return true;
}

function useSelectorOptions(def: ContextSelectorDef): { options: Option[]; refetch: () => void } {
  const [options, setOptions] = React.useState<Option[]>([]);
  const endpoint = def.optionsSource.endpoint;
  const valueKey = def.optionsSource.valueKey || 'id';
  const labelKey = def.optionsSource.labelKey || 'name';
  const filters = def.optionsSource.filter;
  const filterKey = JSON.stringify(filters ?? []);

  // Stable, re-runnable fetch. Without an explicit refetch the option list is
  // read once on mount, so a package created elsewhere (PackagesPage) stays
  // invisible in this dropdown until a full page reload. We refetch on
  // dropdown-open and on a global `objectui:packages-changed` signal.
  const load = React.useCallback(async () => {
    try {
      const res = await fetch(endpoint, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const json = await res.json();
      const rows = extractRows(json);
      const opts: Option[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        if (!rowPasses(row, filters)) continue;
        const value = getByPath(row, valueKey);
        if (value == null || typeof value !== 'string' || seen.has(value)) continue;
        seen.add(value);
        const labelRaw = getByPath(row, labelKey);
        opts.push({ value, label: typeof labelRaw === 'string' && labelRaw ? labelRaw : value });
      }
      opts.sort((a, b) => a.label.localeCompare(b.label));
      setOptions(opts);
    } catch {
      /* offline / unauthorized — render with no options */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, valueKey, labelKey, filterKey]);

  React.useEffect(() => {
    void load();
    const onChanged = () => { void load(); };
    window.addEventListener('objectui:packages-changed', onChanged);
    return () => window.removeEventListener('objectui:packages-changed', onChanged);
  }, [load]);

  return { options, refetch: load };
}

/**
 * Hook: resolves the active values for an app's context selectors and
 * returns a ready-to-render UI element plus the `contextValues` map for
 * `NavigationRenderer`.
 */
export function useAppContextSelectors(
  appName: string,
  selectors: ContextSelectorDef[] | undefined,
  t?: (key: string, options?: any) => string,
): { contextValues: Record<string, string>; element: React.ReactNode } {
  const list = Array.isArray(selectors) ? selectors : [];
  const navigate = useNavigate();
  const location = useLocation();

  // For a `persist: 'query'` selector the query string IS the value. Deriving
  // it from `location` (rather than a parallel useState) keeps the sidebar
  // control in lock-step with the page — no "sidebar says A while the list
  // shows B" drift.
  const params = new URLSearchParams(location.search);

  // …and the non-URL media need a render source of their own. A bare
  // `sessionStorage` read during render would never re-render on write — only
  // the URL medium gets that for free, from `navigate` — so a `'session'` pick
  // would sit invisible until something unrelated re-rendered the sidebar.
  // State is that source: `'session'` seeds it from storage and mirrors writes
  // back, `'none'` keeps it in memory and lets it die with the mount.
  const [storedValues, setStoredValues] = React.useState<Record<string, string>>(
    () => readSessionScopes(appName, list),
  );

  // Selectors can arrive after mount (app metadata loads async), so seed again
  // when the list changes — only for ids not yet resolved, so a pick made in
  // this mount is never overwritten by the storage read trailing behind it.
  React.useEffect(() => {
    const seed = readSessionScopes(appName, list);
    if (Object.keys(seed).length === 0) return;
    setStoredValues((prev) => {
      let next: Record<string, string> | undefined;
      for (const [id, value] of Object.entries(seed)) {
        if (prev[id] !== undefined) continue;
        next ??= { ...prev };
        next[id] = value;
      }
      return next ?? prev;
    });
  }, [appName, list]);

  // NOTE — there is deliberately NO "repair the missing query param from
  // storage" effect any more. It bridged storage → URL for every selector,
  // which is precisely how `'query'` and `'session'` became indistinguishable:
  // a `'query'` selector was silently backed by a second store its author never
  // declared, and `'none'` only opted out of the re-apply while still writing
  // both. With one medium per value there is nothing left to bridge — a
  // `'query'` scope dropped by a param-less nav link is re-established by
  // `SelectorControl`'s auto-select-first (so the surface is never left blank,
  // which was the bridge's stated reason to exist), and an author who wants the
  // pick remembered beyond the URL declares `persist: 'session'`.

  const setValue = React.useCallback((sel: ContextSelectorDef, raw: string) => {
    const value = raw === ALL_SENTINEL ? (sel.allValue ?? '') : raw;
    const mode = persistMode(sel);

    if (mode !== 'query') {
      // `'session'` and `'none'` both render out of state and never touch the
      // URL; they differ only in whether the write is ALSO mirrored to the
      // durable store.
      setStoredValues((prev) => (
        prev[sel.id] === value ? prev : { ...prev, [sel.id]: value }
      ));
      if (mode === 'session') {
        try {
          const key = sessionScopeKey(appName, sel.id);
          if (value) sessionStorage.setItem(key, value);
          else sessionStorage.removeItem(key);
        } catch { /* storage disabled */ }
      }
      return;
    }

    // Reflect the scope onto the current page immediately, under THIS
    // selector's own query key — writing a shared key made a second selector
    // clobber the first's scope. Studio's `active_package` still resolves to
    // `package`, the key its metadata surfaces and nav links already use.
    const next = new URLSearchParams(location.search);
    const key = contextSelectorQueryKey(sel.id);
    if (value) next.set(key, value);
    else next.delete(key);
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  }, [appName, location.pathname, location.search, navigate]);

  // Two selectors resolving to the same query key would silently reintroduce
  // the mirroring this fix removes, and the symptom (both template vars hold
  // one value) reads as a data bug rather than an authoring one. Say so out
  // loud in dev — the renderer cannot reject metadata, only complain.
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const owners = new Map<string, string>();
    for (const sel of list) {
      // Only `'query'` selectors read and write the query string, so only they
      // can mirror each other through it. A `'session'`/`'none'` selector whose
      // id happens to derive the same key never touches it — warning about that
      // pair would be a false positive.
      if (persistMode(sel) !== 'query') continue;
      const key = contextSelectorQueryKey(sel.id);
      const owner = owners.get(key);
      if (owner) {
        console.warn(
          `[ObjectUI] contextSelectors "${owner}" and "${sel.id}" both map to the URL `
          + `scope key "?${key}=" — their values will mirror each other. Rename one id.`,
        );
      } else {
        owners.set(key, sel.id);
      }
    }
  }, [list]);

  // Read side, same exclusivity as the write side: each selector resolves out
  // of its declared medium and no other. Reading "URL ?? storage" for every
  // selector is what let a `'session'` pick be shadowed by a shared link's
  // query string and a `'query'` pick be answered by a store nobody declared.
  const contextValues: Record<string, string> = {};
  for (const sel of list) {
    const active = persistMode(sel) === 'query'
      ? (params.get(contextSelectorQueryKey(sel.id)) ?? '')
      : (storedValues[sel.id] ?? '');
    contextValues[sel.id] = active || (sel.allValue ?? '');
  }

  const element = list.length === 0 ? null : (
    <div className="flex flex-col gap-1.5">
      {list.map((sel) => (
        <SelectorControl
          key={sel.id}
          def={sel}
          value={contextValues[sel.id]}
          onChange={(raw) => setValue(sel, raw)}
          t={t}
        />
      ))}
    </div>
  );

  return { contextValues, element };
}

function SelectorControl({
  def,
  value,
  onChange,
  t,
}: {
  def: ContextSelectorDef;
  value: string;
  onChange: (raw: string) => void;
  t?: (key: string, options?: any) => string;
}) {
  const { options, refetch } = useSelectorOptions(def);
  const Icon = getIcon(def.icon);
  const rawLabel = resolveKeyedI18nLabel(def.label as any, t) || def.id;
  const label = rawLabel === 'Package'
    ? (t?.('common.package', { defaultValue: 'Package' }) ?? rawLabel)
    : rawLabel;
  const placeholder = t?.('actionDialog.selectPlaceholder', {
    label,
    defaultValue: `Select ${label}…`,
  }) ?? `Select ${label}…`;

  // Context selectors are *mandatory scope* selectors: a concrete option must
  // always be active. Allowing an "All" choice would unscope the surface and,
  // for Studio's package filter, leak system metadata. There is no key to
  // ignore any more — `includeAll` and `placement` no longer exist (removed
  // from `AppContextSelectorSchema` in spec 17.0.0, framework#4509 /
  // objectui#3208; this renderer never rendered an "All" row, so
  // `includeAll: false` hardened nothing and `includeAll: true` unlocked
  // nothing). We never render an "All" row, and auto-select the first option
  // as soon as the list resolves when nothing concrete is selected yet.
  const hasConcrete = !!value && value !== (def.allValue ?? '');
  // A LAYOUT effect, deliberately — this one is not interchangeable with
  // `useEffect` (objectstack#6979). As a passive effect the repair was queued
  // for a task AFTER the commit that rendered the options, so it carried a
  // closure captured before that gap: `hasConcrete` still `false`, and (via
  // `onChange`) a `location.search` that predated anything the gap contained.
  // A pick made inside the gap — a user clicking an option the instant it
  // appears, on a loaded machine or a slow device — was therefore navigated
  // away again by this effect firing second with `options[0]`, silently
  // replacing the user's choice with the first row. Running in the commit phase
  // closes the gap at its source: the repair lands in the same synchronous
  // flush as the options it reacts to, so no event can be delivered in
  // between, and the control is never painted with an empty value while
  // options exist. Everything else is unchanged — same trigger, same deps, so
  // a scope dropped later by a param-less nav link is still re-established.
  React.useLayoutEffect(() => {
    if (hasConcrete) {
      return;
    }
    if (options.length > 0) {
      onChange(options[0].value);
    }
  }, [hasConcrete, onChange, options]);

  const current = hasConcrete ? value : '';

  return (
    <Select
      value={current}
      onValueChange={onChange}
      onOpenChange={(open) => { if (open) refetch(); }}
    >
      <SelectTrigger
        aria-label={label}
        data-testid="package-switcher"
        className="h-9 w-full gap-2 rounded-md border-sidebar-border/70 bg-sidebar/80 px-2 text-xs font-medium text-sidebar-foreground shadow-none transition-colors hover:bg-sidebar-accent focus:ring-1 focus:ring-sidebar-ring data-[state=open]:bg-sidebar-accent [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-sidebar-border/70 bg-sidebar-accent text-sidebar-foreground/70">
            {/* eslint-disable-next-line react-hooks/static-components -- getIcon returns a stable icon component from a static registry, not one created during render */}
            <Icon className="h-3 w-3" />
          </span>
          <SelectValue placeholder={placeholder} className="truncate" />
        </div>
      </SelectTrigger>
      <SelectContent className="w-[var(--radix-select-trigger-width)]">
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
