import { createContext, useContext, useEffect, useState } from 'react';
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

// ---------------------------------------------------------------------------
// AdapterContext
// ---------------------------------------------------------------------------

export const AdapterCtx = createContext<ObjectStackAdapter | null>(null);

export function useAdapter(): ObjectStackAdapter | null {
  return useContext(AdapterCtx);
}

// ---------------------------------------------------------------------------
// MetadataContext
// ---------------------------------------------------------------------------

/**
 * The metadata PROVIDER's cache — the collections `<MetadataProvider>` holds in
 * React state, plus its aggregate load flags.
 *
 * Renamed from `MetadataState` in objectui#4167. `@objectstack/spec` 17.0.0-rc.6
 * publishes `MetadataState` from `@objectstack/spec/system`, and it names a
 * different thing in the SAME domain and the SAME two words: a metadata item's
 * LIFECYCLE state, `'draft' | 'active' | 'deprecated' | 'archived'`
 * (`MetadataStateSchema`). That is the `AuthProviderConfig` judgement from
 * objectstack#4115 batch 5, not the `AuthProvider` one — nothing about a JSX
 * element can be mistaken for a zod enum, but "the metadata state" absolutely
 * can be read as canonical for the lifecycle enum by the next agent, and the
 * two are mutually unassignable (an object of five arrays vs a string union),
 * so nothing would have caught the misreading at the point it was made.
 *
 * `Cache` rather than a bare disambiguating prefix because it is what this is:
 * `MetadataProvider` is a TTL cache with per-type entries, and these five
 * arrays are its materialized contents.
 */
export interface MetadataCacheState {
  apps: any[];
  objects: any[];
  dashboards: any[];
  reports: any[];
  pages: any[];
  loading: boolean;
  error: Error | null;
}

export type MetadataTypeStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MetadataContextValue extends MetadataCacheState {
  refresh: (type?: string) => Promise<void>;
  invalidate: (type: string, name?: string) => void;
  ensureType: (type: string) => Promise<any[]>;
  getItem: (type: string, name: string) => Promise<any | null>;
  getItemsByType: (type: string) => any[];
  /**
   * Per-type load status. Lazy types ('page', 'dashboard', …) return their
   * items array immediately — empty or stale while a (re)fetch is in flight —
   * so consumers that DIFF the list over time (e.g. NavigationSyncEffect)
   * must distinguish "empty because unloaded" from "actually empty" and only
   * trust snapshots taken while the type is 'ready'. Optional so hand-rolled
   * context values in tests keep working; absent means "always ready".
   */
  getTypeStatus?: (type: string) => MetadataTypeStatus;
  /**
   * The object definitions one app reads (objectui#12811): the objects of
   * `packageId` (`GET /api/v1/meta/object?package=`), plus each of `names`
   * that package does not hold, fetched by name. Each is shaped exactly as the
   * same definition in `objects`; `served` holds the same definitions as the
   * server served them, before views are merged (as `getItemsByType('object')`
   * holds the whole list). `missing` lists the `names` the server answered
   * without a definition; `settled` is true once the package list and every
   * name have been answered.
   *
   * With `names` and no `packageId` it is a names-only scope (objectui#12980):
   * no package list, each of `names` fetched by name, for a reader with no
   * package to scope by (a page route in an app item without `_packageId`).
   * With neither it is the whole registry, as `objects` is; `objects` keeps
   * that meaning everywhere. Optional, as `getTypeStatus` is: a
   * hand-rolled context without it has nothing narrower to offer, and its
   * readers read `objects`.
   */
  readObjectScope?: (scope: { packageId?: string; names?: readonly string[] }) => {
    objects: any[];
    served: any[];
    missing: readonly string[];
    settled: boolean;
  };
}

export const MetadataCtx = createContext<MetadataContextValue | null>(null);

/** Shared frozen empty list for the fallback below — see {@link NO_METADATA_PROVIDER}. */
const NO_ITEMS = Object.freeze([]) as unknown as any[];

/**
 * The no-provider fallback, as a MODULE-LEVEL SINGLETON.
 *
 * Identity matters here, not just shape. `useMetadata()` used to build this
 * object inline on every call, so outside a `<MetadataProvider>` every render
 * produced a new `getItem` — and `useMetadataItem` lists `getItem` in its
 * effect deps and calls `setState({...})` with a fresh object on every run. New
 * identity → effect re-runs → new state object → re-render → new identity: an
 * unbreakable render loop, synchronous enough to hang inside `render()`.
 *
 * So the fallback documented as the graceful path for consumers mounted outside
 * a provider was the one thing that made those consumers impossible to mount —
 * `record:alert` and `record:quick_actions` both call `useMetadataItem`
 * unconditionally, and both spin. Found by
 * `apps/console/src/__tests__/record-block-record-reach.test.tsx`
 * (objectui#3149), which could not mount them at all until this was frozen.
 *
 * Frozen so a consumer cannot mutate the shared fallback out from under every
 * other consumer of it.
 */
const NO_METADATA_PROVIDER: MetadataContextValue = Object.freeze({
  apps: NO_ITEMS,
  objects: NO_ITEMS,
  dashboards: NO_ITEMS,
  reports: NO_ITEMS,
  pages: NO_ITEMS,
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
});

export function useMetadata(): MetadataContextValue {
  const ctx = useContext(MetadataCtx);
  // Graceful fallback: a consumer rendered outside a MetadataProvider (unit
  // tests that only assert on rendering, standalone previews) gets an empty
  // no-op implementation rather than a crash. Production code paths should
  // always wrap in <MetadataProvider>.
  return ctx ?? NO_METADATA_PROVIDER;
}

export function useMetadataItem(
  type: string,
  name: string | undefined | null,
): { item: any | null; loading: boolean; error: Error | null } {
  const { getItem } = useMetadata();
  const [state, setState] = useState<{ item: any | null; loading: boolean; error: Error | null }>({
    item: null,
    loading: !!name,
    error: null,
  });

  useEffect(() => {
    if (!name) {
      // Bail out when already cleared instead of installing a fresh object.
      // Belt-and-braces against the loop the frozen fallback above fixes at the
      // source: `getItem` is an effect dep, so ANY caller whose context value
      // is rebuilt per render — a hand-rolled one in a test, which this
      // interface explicitly invites — would otherwise re-run this effect,
      // re-set an equal-but-new state object, and re-render forever.
      setState((s) => (s.item === null && !s.loading && s.error === null
        ? s
        : { item: null, loading: false, error: null }));
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    getItem(type, name)
      .then(item => {
        if (!cancelled) setState({ item, loading: false, error: null });
      })
      .catch(err => {
        if (!cancelled) {
          setState({
            item: null,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [type, name, getItem]);

  return state;
}
