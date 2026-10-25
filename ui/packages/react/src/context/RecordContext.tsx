/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * RecordContext — shared record state for `record:*` namespace renderers
 * inside a `PageSchema` (type='record'). The page host (e.g. RecordDetailView)
 * mounts <RecordContextProvider> once; each `record:details / record:related_list
 * / record:highlights / record:activity / record:chatter / record:path` renderer
 * inside the page consumes data via `useRecordContext()` instead of having to
 * receive props from the schema tree.
 */

import React from 'react';
import type { DataSource } from '@object-ui/types';

/**
 * Shared registry of field names currently surfaced by `record:highlights`
 * on the page. Populated by RecordHighlightsRenderer, consumed by
 * RecordDetailsRenderer for highlight↔body dedup.
 *
 * Lives in a separate context so highlight registration doesn't invalidate
 * the main RecordContext consumers.
 */
interface HighlightRegistry {
  getNames: () => ReadonlySet<string>;
  subscribe: (listener: () => void) => () => void;
  register: (instanceId: string, names: string[]) => void;
  unregister: (instanceId: string) => void;
}

const HighlightFieldsContext = React.createContext<HighlightRegistry | null>(null);

export const HighlightFieldsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const registry = React.useMemo<HighlightRegistry>(() => {
    const map = new Map<string, string[]>();
    let names: ReadonlySet<string> = EMPTY_SET;
    const listeners = new Set<() => void>();
    const recompute = () => {
      const next = new Set<string>();
      for (const list of map.values()) for (const n of list) next.add(n);
      // Skip notify if shallow-equal to previous (avoid spurious updates).
      if (next.size === names.size) {
        let same = true;
        for (const n of next) if (!names.has(n)) { same = false; break; }
        if (same) return;
      }
      names = next;
      listeners.forEach((l) => l());
    };
    return {
      getNames: () => names,
      subscribe: (l) => {
        listeners.add(l);
        return () => { listeners.delete(l); };
      },
      register: (id, list) => {
        const prev = map.get(id);
        if (
          prev &&
          prev.length === list.length &&
          prev.every((n, i) => n === list[i])
        ) {
          return;
        }
        map.set(id, [...list]);
        recompute();
      },
      unregister: (id) => {
        if (map.delete(id)) recompute();
      },
    };
  }, []);

  return (
    <HighlightFieldsContext.Provider value={registry}>
      {children}
    </HighlightFieldsContext.Provider>
  );
};

/** Subscribe to the live highlight-field set. Empty when no provider. */
export function useHighlightFieldNames(): ReadonlySet<string> {
  const ctx = React.useContext(HighlightFieldsContext);
  return React.useSyncExternalStore(
    ctx ? ctx.subscribe : NOOP_SUBSCRIBE,
    ctx ? ctx.getNames : GET_EMPTY,
    ctx ? ctx.getNames : GET_EMPTY,
  );
}

/**
 * Register a list of field names as currently surfaced by a
 * `record:highlights` instance. Re-registers when the joined name list
 * changes; unregisters on unmount.
 */
export function useRegisterHighlightFields(instanceId: string, names: string[]): void {
  const ctx = React.useContext(HighlightFieldsContext);
  const key = names.join('|');
  React.useEffect(() => {
    if (!ctx) return;
    ctx.register(instanceId, key.length === 0 ? [] : key.split('|'));
    return () => ctx.unregister(instanceId);
  }, [ctx, instanceId, key]);
}

const NOOP_SUBSCRIBE = (_: () => void) => () => {};
const GET_EMPTY: () => ReadonlySet<string> = () => EMPTY_SET;
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

export interface RecordContextValue<TData = any, TObjectSchema = any> {
  /** Object machine name, e.g. "crm_opportunity". */
  objectName: string;
  /**
   * Primary key value of the record being displayed, as a `string` -- the one
   * spelling `@objectstack/spec` declares on every record door (get, update,
   * delete and the batch operation are all `z.string()`), so this consumer
   * type is no longer wider than the protocol (objectui#9333).
   *
   * A host whose primary keys are numeric does NOT stringify at its call
   * sites: `RecordContextProviderProps` still accepts `string | number`, and
   * the provider pays the conversion once, below.
   *
   * `LineItemsPanel` reads this member as a `string` and hands it to a
   * `string` parameter with no assertion in between, which is what
   * objectui#9304 had to leave behind. That is a statement about that one
   * reader, not about every reader: three `record:*` renderers in
   * `@object-ui/plugin-detail` -- `record-details`, `record-quick-actions` and
   * `record-alert` -- still read it through an `as any`. Those casts are
   * redundant now rather than load-bearing, and removing them was left outside
   * objectui#9333 deliberately.
   */
  recordId: string | null | undefined;
  /**
   * The data adapter the page is bound to, as the host resolved it — the same
   * object the host hands `SchemaRendererProvider`, forwarded so that
   * `record:*` renderers can self-fetch (related lists, activity, the
   * reference rail) without re-plumbing it through the schema tree.
   *
   * Typed `DataSource`, not an id: every producer has always passed the
   * adapter, and every reader has always called adapter methods on it
   * (objectui#9197). `getObjectSchema` is a REQUIRED member of `DataSource`,
   * so a reader gets the compiler's answer about it instead of a cast.
   *
   * Optional: hosts that render a record with no adapter bound (the Studio
   * designer and palette previews) leave it undefined, and renderers treat
   * that as "cannot self-fetch" rather than throwing.
   */
  dataSource?: DataSource;
  /** Loaded record data (flat record map). Undefined while loading. */
  data?: TData;
  /** Resolved object metadata schema (fields, label, etc.). */
  objectSchema?: TObjectSchema;
  /** Re-fetch the record from the source. */
  refresh?: () => void | Promise<void>;
  /**
   * Optional system-level header actions (Edit / Share / Delete) that the
   * host (e.g. RecordDetailView) wants to inject into the page header
   * regardless of whether the page schema is synthesised or authored.
   *
   * `PageHeaderRenderer` appends these AFTER any authored
   * `page:header.actions`, deduplicating by `name`. Hosts pass `undefined`
   * to opt out entirely (e.g. embedded previews).
   */
  headerSystemActions?: any[];
  /**
   * Controlled favourite state for the record-header star (rendered by
   * `RecordTitleChip` via `PageHeaderRenderer`). When the host provides
   * this, the chip mirrors it instead of managing its own local state.
   */
  isFavorite?: boolean;
  /**
   * Called when the user toggles the record-header favourite star. Hosts
   * persist the change (e.g. through `useFavorites`) and update
   * `isFavorite` accordingly.
   */
  onToggleFavorite?: () => void;
  /**
   * Host-injected, optional (objectui#13385): a one-line note about how the
   * object is managed, shown on hover and focus of the record header's
   * object-label chip (`RecordTitleChip` via `PageHeaderRenderer`), e.g.
   * "Organization · Managed by the identity provider". The host decides when
   * there is one and passes it already translated; absent, the chip draws the
   * plain label exactly as before. Never authored in a page schema.
   */
  objectLabelNote?: string;
  /**
   * When true, the record is rendered inside a host overlay (drawer,
   * modal, split-pane preview) rather than as a standalone route. Header
   * affordances such as the auto "back to list" button should suppress
   * themselves in this mode because the user already has Close / Expand
   * controls in the overlay chrome.
   */
  embedded?: boolean;
}

const RecordContext = React.createContext<RecordContextValue | null>(null);

/**
 * Props of `RecordContextProvider` -- THE injection boundary (objectui#9333).
 *
 * Identical to `RecordContextValue` except for `recordId`, the one member a
 * host may still hand over in the wider shape its backend actually holds. The
 * provider narrows it to the protocol's `string` exactly once, here, so no
 * consumer downstream carries a `String(...)` or a cast.
 */
export interface RecordContextProviderProps extends Omit<RecordContextValue, 'recordId'> {
  /** Primary key as the host holds it; narrowed to `string` on the way in. */
  recordId: string | number | null | undefined;
  children: React.ReactNode;
}

export const RecordContextProvider: React.FC<RecordContextProviderProps> = ({
  children,
  recordId,
  ...rest
}) => {
  // The whole conversion for this contract, in one typed place. Gated on
  // `typeof` rather than written as an unconditional `String(...)`: `null` and
  // `undefined` mean "no record bound", and stringifying them would hand
  // consumers the literal ids "null" / "undefined". A falsiness gate would be
  // wrong in the other direction -- a numeric `0` is a real primary key.
  const value: RecordContextValue = {
    ...rest,
    recordId: typeof recordId === 'number' ? String(recordId) : recordId,
  };
  // Memoize so consumers that rely on referential equality don't re-render
  // on unrelated parent renders.
  const memo = React.useMemo<RecordContextValue>(() => value, [
    value.objectName,
    value.recordId,
    value.dataSource,
    value.data,
    value.objectSchema,
    value.refresh,
    value.embedded,
    value.headerSystemActions,
    value.isFavorite,
    value.onToggleFavorite,
    value.objectLabelNote,
  ]);
  return <RecordContext.Provider value={memo}>{children}</RecordContext.Provider>;
};

/**
 * Read the current record context. Returns `null` when called outside a
 * <RecordContextProvider> — record:* renderers should treat that as "no
 * record bound" rather than throwing, so they can still render statically
 * inside the Studio designer/palette.
 */
export function useRecordContext<TData = any, TObjectSchema = any>():
  RecordContextValue<TData, TObjectSchema> | null {
  return React.useContext(RecordContext) as RecordContextValue<TData, TObjectSchema> | null;
}
