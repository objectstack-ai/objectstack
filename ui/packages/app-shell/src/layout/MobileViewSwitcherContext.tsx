/**
 * MobileViewSwitcherContext
 *
 * Lightweight page → header data channel that lets a view-driven page
 * (e.g. `ObjectView`) expose its list of available views, the active
 * view id, and a change handler to the mobile `AppHeader` topbar.
 *
 * On mobile (<sm), the AppHeader replaces its static page label with a
 * `<viewName> ▾` dropdown trigger when a switcher has been registered.
 * Desktop continues to use the inline `ViewTabBar` and ignores this
 * context entirely.
 *
 * Design notes:
 *   - The provider stores a single nullable value (last registered wins).
 *     This matches reality — only one ObjectView is rendered at a time
 *     under the AppHeader. Concurrent registrations are not supported.
 *   - Consumers must wrap their registration object in `useMemo` (or
 *     pass primitive refs) so the value identity is stable across renders
 *     and we don't spam AppHeader re-renders.
 *   - When the page unmounts or no longer wants to expose a switcher,
 *     the effect cleanup sets the value back to `null` and AppHeader
 *     falls back to the static breadcrumb label.
 *
 * @module
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/** Shape of a single view option in the mobile dropdown. */
export interface MobileViewSwitcherItem {
  /** Stable view identifier (matches `activeViewId`). */
  id: string;
  /** Display label shown in the dropdown row. */
  label: string;
  /** Optional Lucide icon node rendered before the label. */
  icon?: React.ReactNode;
  /** Optional secondary hint (e.g. owner, "private"). */
  hint?: string;
  /** When true, show a lock indicator (e.g. permission-locked). */
  locked?: boolean;
}

/** Value registered by a page (e.g. ObjectView) for the mobile switcher. */
export interface MobileViewSwitcherValue {
  /** All views available on this page. May be a single entry. */
  views: MobileViewSwitcherItem[];
  /** Currently active view id. */
  activeViewId: string;
  /** Invoked when the user picks a view from the dropdown. */
  onChange: (id: string) => void;
  /**
   * Optional override for the trigger label. Defaults to the active
   * view's `label`. Provide e.g. `Object · View` if you want both.
   */
  triggerLabel?: string;
}

interface MobileViewSwitcherContextValue {
  value: MobileViewSwitcherValue | null;
  /**
   * Internal — used by `useRegisterMobileViewSwitcher`. Do not call
   * directly from product code.
   */
  setValue: (v: MobileViewSwitcherValue | null) => void;
}

const MobileViewSwitcherContext = createContext<MobileViewSwitcherContextValue | null>(null);

/** Provider — mount once near the top of the console tree (above AppHeader). */
export function MobileViewSwitcherProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<MobileViewSwitcherValue | null>(null);
  const ctx = useMemo(() => ({ value, setValue }), [value]);
  return (
    <MobileViewSwitcherContext.Provider value={ctx}>
      {children}
    </MobileViewSwitcherContext.Provider>
  );
}

/** Read the currently registered switcher value (or `null`). */
export function useMobileViewSwitcher(): MobileViewSwitcherValue | null {
  const ctx = useContext(MobileViewSwitcherContext);
  return ctx?.value ?? null;
}

/**
 * Register a switcher value for the duration of the calling component's
 * lifetime. Passing `null` (or `undefined`) is a no-op — useful for
 * conditional pages that sometimes don't want a switcher.
 *
 * Wrap the value in `useMemo` and ensure `onChange` is stable
 * (`useCallback`) so we only re-publish when something materially changes.
 */
export function useRegisterMobileViewSwitcher(value: MobileViewSwitcherValue | null | undefined) {
  const ctx = useContext(MobileViewSwitcherContext);
  const lastRef = useRef<MobileViewSwitcherValue | null>(null);

  useEffect(() => {
    if (!ctx) return undefined;
    const next = value ?? null;
    ctx.setValue(next);
    lastRef.current = next;
    return () => {
      // Only clear if nobody else has overwritten us in the meantime.
      // (Last-mounted wins; on unmount, we still reset to null so a stale
      //  switcher doesn't leak into the next page.)
      ctx.setValue(null);
    };
  }, [ctx, value]);
}

/**
 * Convenience: build + register in one call. Stabilises identity via
 * useMemo so callers don't need to memoize themselves.
 */
export function useMobileViewSwitcherRegistration(input: {
  views: MobileViewSwitcherItem[];
  activeViewId: string;
  onChange: (id: string) => void;
  triggerLabel?: string;
  enabled?: boolean;
}) {
  const { views, activeViewId, onChange, triggerLabel, enabled = true } = input;
  // Stabilise onChange identity if caller didn't already useCallback.
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;
  const stableOnChange = useCallback((id: string) => handlerRef.current(id), []);
  const value = useMemo<MobileViewSwitcherValue | null>(() => {
    if (!enabled) return null;
    return { views, activeViewId, onChange: stableOnChange, triggerLabel };
  }, [enabled, views, activeViewId, stableOnChange, triggerLabel]);
  useRegisterMobileViewSwitcher(value);
}
