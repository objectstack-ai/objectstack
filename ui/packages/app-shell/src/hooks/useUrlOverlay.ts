/**
 * useUrlOverlay
 *
 * Router-aware open-state for a navigable overlay (command palette, keyboard-
 * shortcuts dialog, record drawer, action dialog, wizard step). The open state
 * is stored in a `?<key>=1` URL search param instead of component `useState`.
 *
 * Why — ADR-0054 "UI testability contract", invariant C3 (URL-addressable
 * state) + C1 (idempotent, direct triggers):
 *
 *  - **Deep-linkable / restore-on-reload / back-forward aware.** Open state is
 *    a single source of truth in the URL, so the overlay can be reached by
 *    navigating to a URL — the most powerful automation primitive — and shared
 *    as a link.
 *  - **Idempotent open.** `openOverlay()` / `setOpen(true)` are no-ops when the
 *    overlay is already open (they never toggle), so an automated driver can
 *    always *ensure* it is open. `toggleOverlay()` is provided separately for
 *    keyboard accelerators (close-on-repeat).
 *
 * This generalizes the command-palette implementation from ADR-0054 Phase 1 so
 * every navigable overlay can adopt the same contract with one line.
 *
 * @example
 * const { open, setOpen, openOverlay } = useUrlOverlay('palette', { alias: 'cmdk' });
 * // header button:        onClick={openOverlay}
 * // dialog:               <Dialog open={open} onOpenChange={setOpen}>
 * // deep-link that opens:  /apps/foo?palette=1
 *
 * @module
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface UseUrlOverlayOptions {
  /**
   * Additional param name(s) accepted as "open" on read (e.g. a legacy alias).
   * Writes always use the canonical `key`; aliases are removed when present.
   */
  alias?: string | string[];
  /** The truthy value written/compared for the param. Defaults to `'1'`. */
  value?: string;
  /**
   * Use `history.replaceState` instead of `pushState` when toggling. Defaults
   * to `true` so a transient overlay doesn't pile up browser-history entries.
   */
  replace?: boolean;
}

export interface UrlOverlayControls {
  /** Whether the overlay is currently open (derived from the URL). */
  open: boolean;
  /** Idempotent setter — no navigation when already in the target state. */
  setOpen: (open: boolean) => void;
  /** Idempotent open — a no-op when already open (C1). */
  openOverlay: () => void;
  /** Idempotent close. */
  closeOverlay: () => void;
  /** Toggle — for keyboard accelerators, not for "open" affordances. */
  toggleOverlay: () => void;
}

function asArray(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Manage a navigable overlay's open state via a `?<key>=1` URL param.
 *
 * Must be called inside a React Router context (uses `useSearchParams`).
 */
export function useUrlOverlay(key: string, options?: UseUrlOverlayOptions): UrlOverlayControls {
  const { alias, value = '1', replace = true } = options ?? {};
  const [searchParams, setSearchParams] = useSearchParams();

  const aliasKeys = useMemo(() => asArray(alias), [alias]);

  const isOpen = useCallback(
    (params: URLSearchParams) =>
      params.get(key) === value || aliasKeys.some((a) => params.get(a) === value),
    [key, value, aliasKeys],
  );

  const open = isOpen(searchParams);

  const setOpen = useCallback(
    (next: boolean) => {
      // Truly idempotent: when already in the target state, do nothing — no
      // redundant history navigation.
      if (next === isOpen(searchParams)) return;
      const sp = new URLSearchParams(searchParams);
      if (next) {
        sp.set(key, value);
        for (const a of aliasKeys) sp.delete(a);
      } else {
        sp.delete(key);
        for (const a of aliasKeys) sp.delete(a);
      }
      setSearchParams(sp, { replace });
    },
    [isOpen, searchParams, setSearchParams, key, value, aliasKeys, replace],
  );

  const openOverlay = useCallback(() => setOpen(true), [setOpen]);
  const closeOverlay = useCallback(() => setOpen(false), [setOpen]);

  // Toggle uses the functional updater so it never depends on `open` — keeping
  // a keydown listener that references it stable across navigations.
  const toggleOverlay = useCallback(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        if (isOpen(sp)) {
          sp.delete(key);
          for (const a of aliasKeys) sp.delete(a);
        } else {
          sp.set(key, value);
          for (const a of aliasKeys) sp.delete(a);
        }
        return sp;
      },
      { replace },
    );
  }, [setSearchParams, isOpen, key, value, aliasKeys, replace]);

  return { open, setOpen, openOverlay, closeOverlay, toggleOverlay };
}
