/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/react - ThemeContext
 *
 * React context + provider for the Theme System.
 * Converts a spec-aligned Theme JSON into CSS custom properties
 * and manages mode switching, theme registration, and persistence.
 *
 * @module context/ThemeContext
 * @packageDocumentation
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import type { Theme, ThemeMode } from '@object-ui/types';
import {
  generateThemeVars,
  resolveThemeInheritance,
  resolveMode,
} from '@object-ui/core';

// ============================================================================
// Types
// ============================================================================

/**
 * The public API surface of the theme system, available via useTheme().
 */
export interface ThemeContextValue {
  /** The fully resolved active theme (after inheritance) */
  theme: Theme | null;

  /** The effective mode: 'light' or 'dark' (resolved from 'auto') */
  resolvedMode: 'light' | 'dark';

  /** The raw mode setting (may be 'auto') */
  mode: ThemeMode;

  /** Name of the active theme */
  activeTheme: string | null;

  /** List of available themes */
  themes: Theme[];

  /** Switch to a different theme by name */
  setTheme: (name: string) => void;

  /** Switch mode (light / dark / auto) */
  setMode: (mode: ThemeMode) => void;

  /** The generated CSS custom property map */
  cssVars: Record<string, string>;
}

/**
 * Props for the ThemeProvider component.
 */
export interface ThemeProviderProps {
  /** Available theme definitions */
  themes?: Theme[];

  /** Initial active theme name (default: first theme) */
  defaultTheme?: string;

  /** Initial mode (default: 'auto') */
  defaultMode?: ThemeMode;

  /** Persist theme/mode to localStorage */
  persist?: boolean;

  /** localStorage key prefix */
  storageKey?: string;

  /** Target element for CSS variable injection (default: document.documentElement) */
  target?: HTMLElement | null;

  /** Children */
  children: React.ReactNode;
}

// ============================================================================
// Context
// ============================================================================

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Default storage keys
 */
const DEFAULT_STORAGE_KEY = 'objectui-theme';

// ============================================================================
// Provider
// ============================================================================

/**
 * ThemeProvider
 *
 * Wraps a subtree with theme context. It:
 * 1. Maintains theme + mode state
 * 2. Resolves theme inheritance (extends)
 * 3. Converts the active theme → CSS custom properties
 * 4. Injects those CSS variables into the DOM
 * 5. Applies 'dark' / 'light' class to the target element
 * 6. Optionally persists user preference to localStorage
 *
 * @example
 * ```tsx
 * <ThemeProvider themes={[myTheme]} defaultTheme="my-theme" defaultMode="auto">
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({
  themes: themesInput = [],
  defaultTheme,
  defaultMode = 'auto',
  persist = false,
  storageKey = DEFAULT_STORAGE_KEY,
  target,
  children,
}: ThemeProviderProps) {
  // ---- Build theme registry ----
  const registry = useMemo(() => {
    const map = new Map<string, Theme>();
    for (const t of themesInput) {
      map.set(t.name, t);
    }
    return map;
  }, [themesInput]);

  // ---- Load persisted state ----
  const loadPersistedTheme = useCallback((): string | undefined => {
    if (!persist) return undefined;
    try {
      if (typeof window !== 'undefined') {
        return localStorage.getItem(`${storageKey}-name`) ?? undefined;
      }
    } catch { /* ignore */ }
    return undefined;
  }, [persist, storageKey]);

  const loadPersistedMode = useCallback((): ThemeMode | undefined => {
    if (!persist) return undefined;
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(`${storageKey}-mode`);
        if (stored === 'light' || stored === 'dark' || stored === 'auto') {
          return stored;
        }
      }
    } catch { /* ignore */ }
    return undefined;
  }, [persist, storageKey]);

  // ---- State ----
  const [activeThemeName, setActiveThemeName] = useState<string | null>(
    () => loadPersistedTheme() ?? defaultTheme ?? themesInput[0]?.name ?? null,
  );

  const [mode, setModeState] = useState<ThemeMode>(
    () => loadPersistedMode() ?? defaultMode,
  );

  // ---- Resolve theme ----
  const resolvedTheme = useMemo(() => {
    if (!activeThemeName) return null;
    const base = registry.get(activeThemeName);
    if (!base) return null;
    return resolveThemeInheritance(base, registry);
  }, [activeThemeName, registry]);

  // ---- Resolve mode ----
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // Listen to system preference changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedMode = useMemo(
    () => resolveMode(mode, systemDark),
    [mode, systemDark],
  );

  // ---- Generate CSS variables ----
  const cssVars = useMemo(() => {
    if (!resolvedTheme) return {};
    return generateThemeVars(resolvedTheme);
  }, [resolvedTheme]);

  // ---- Inject CSS variables into the DOM ----
  useEffect(() => {
    const el = target ?? (typeof document !== 'undefined' ? document.documentElement : null);
    if (!el) return;

    // Apply CSS variables
    const previousValues: Record<string, string> = {};
    for (const [prop, value] of Object.entries(cssVars)) {
      previousValues[prop] = el.style.getPropertyValue(prop);
      el.style.setProperty(prop, value);
    }

    // Apply mode class
    el.classList.remove('light', 'dark');
    el.classList.add(resolvedMode);

    // No favicon here: spec v17 (objectstack-ai/objectstack#3494) pruned `Theme.logo`, so the key is
    // stripped at parse and could never arrive. The live favicon comes from
    // operator branding (`getFaviconUrl()`), applied in the console's
    // index.html, main.tsx, and on route change.

    return () => {
      // Cleanup: remove injected vars
      for (const prop of Object.keys(cssVars)) {
        if (previousValues[prop]) {
          el.style.setProperty(prop, previousValues[prop]);
        } else {
          el.style.removeProperty(prop);
        }
      }
      el.classList.remove(resolvedMode);
    };
  }, [cssVars, resolvedMode, resolvedTheme, target]);

  // ---- Persistence ----
  useEffect(() => {
    if (!persist) return;
    try {
      if (activeThemeName) {
        localStorage.setItem(`${storageKey}-name`, activeThemeName);
      }
      localStorage.setItem(`${storageKey}-mode`, mode);
    } catch { /* ignore */ }
  }, [persist, storageKey, activeThemeName, mode]);

  // ---- Actions ----
  const setTheme = useCallback((name: string) => {
    if (registry.has(name)) {
      setActiveThemeName(name);
    }
  }, [registry]);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
  }, []);

  // ---- Context value ----
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: resolvedTheme,
      resolvedMode,
      mode,
      activeTheme: activeThemeName,
      themes: themesInput,
      setTheme,
      setMode,
      cssVars,
    }),
    [resolvedTheme, resolvedMode, mode, activeThemeName, themesInput, setTheme, setMode, cssVars],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useTheme — access the current theme context.
 *
 * @example
 * ```tsx
 * const { theme, resolvedMode, setMode, setTheme } = useTheme();
 * ```
 *
 * @throws Error if used outside a ThemeProvider
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}

/**
 * useOptionalTheme — like useTheme() but returns null outside a provider.
 * Useful for components that should work with or without a theme.
 */
export function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
