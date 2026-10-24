import { createContext, useContext, useEffect, useState } from 'react';
import type { ThemePreference, ThemePreferenceProviderProps } from './types.js';

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * ThemeProvider - Theme management
 *
 * Provides theme context and handles system theme detection.
 * Extracted from console for reuse in third-party applications.
 */
export function ThemeProvider({
  defaultTheme = 'system',
  storageKey = 'ui-theme',
  children,
}: ThemePreferenceProviderProps) {
  const [theme, setTheme] = useState<ThemePreference>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem(storageKey) as ThemePreference) || defaultTheme;
    }
    return defaultTheme;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    // The spec's OS-following mode is `auto` (ThemeModeSchema, ui/theme.zod.ts);
    // `system` is this provider's pre-spec spelling, kept for stored values.
    // Branching on `system` alone sent `auto` into `classList.add('auto')` —
    // a class no Tailwind variant matches, locking the light theme (#2942).
    if (theme === 'auto' || theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  const value: ThemeContextValue = {
    theme,
    setTheme: (newTheme: ThemePreference) => {
      localStorage.setItem(storageKey, newTheme);
      setTheme(newTheme);
    },
  };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Hook to access theme from context
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
