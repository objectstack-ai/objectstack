/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Theme } from '@object-ui/types';
import {
  ThemeProvider,
  useTheme,
  useOptionalTheme,
} from '../context/ThemeContext';

// ============================================================================
// Fixtures
// ============================================================================

const lightTheme: Theme = {
  name: 'light',
  label: 'Light',
  mode: 'light',
  colors: {
    primary: '#3B82F6',
    secondary: '#64748B',
    background: '#FFFFFF',
    text: '#0F172A',
    error: '#EF4444',
  },
  typography: {
    // `fontFamily.base` is the only surviving typography key: `fontSize` (and
    // `fontWeight` / `lineHeight` / `letterSpacing`) became tombstones in
    // @objectstack/spec 17.0.0-rc.3, prescribing `theme.customVars` instead
    // (objectstack#5021). The fixture carried `fontSize: { base: '1rem' }`
    // until this package started type-checking its tests (objectui#4040); no
    // assertion in this file ever read it.
    fontFamily: { base: 'Inter, sans-serif' },
  },
  borderRadius: { base: '0.25rem', lg: '0.5rem' },
};

const darkTheme: Theme = {
  name: 'dark',
  label: 'Dark',
  mode: 'dark',
  colors: {
    primary: '#60A5FA',
    secondary: '#94A3B8',
    background: '#0F172A',
    text: '#F1F5F9',
    error: '#FCA5A5',
  },
};

const childTheme: Theme = {
  name: 'corporate',
  label: 'Corporate',
  colors: { primary: '#1E40AF' },
  extends: 'light',
};

function createWrapper(props: Omit<React.ComponentProps<typeof ThemeProvider>, 'children'>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <ThemeProvider {...props}>{children}</ThemeProvider>;
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  // Clean DOM state
  document.documentElement.style.cssText = '';
  document.documentElement.className = '';
  localStorage.clear();
});

afterEach(() => {
  document.documentElement.style.cssText = '';
  document.documentElement.className = '';
  localStorage.clear();
});

// ============================================================================
// useTheme — basic context
// ============================================================================

describe('useTheme', () => {
  it('should throw when used outside ThemeProvider', () => {
    expect(() => {
      renderHook(() => useTheme());
    }).toThrow('useTheme must be used within a <ThemeProvider>');
  });

  it('should return theme context when inside ThemeProvider', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme] }),
    });

    expect(result.current.theme).toBeTruthy();
    expect(result.current.theme?.name).toBe('light');
    expect(result.current.activeTheme).toBe('light');
  });

  it('should default to first theme when no defaultTheme', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [darkTheme, lightTheme] }),
    });

    expect(result.current.activeTheme).toBe('dark');
  });

  it('should use defaultTheme when provided', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme, darkTheme], defaultTheme: 'dark' }),
    });

    expect(result.current.activeTheme).toBe('dark');
  });

  it('should return empty state when no themes', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [] }),
    });

    expect(result.current.theme).toBeNull();
    expect(result.current.activeTheme).toBeNull();
    expect(result.current.cssVars).toEqual({});
  });
});

// ============================================================================
// useOptionalTheme
// ============================================================================

describe('useOptionalTheme', () => {
  it('should return null outside ThemeProvider', () => {
    const { result } = renderHook(() => useOptionalTheme());
    expect(result.current).toBeNull();
  });

  it('should return context inside ThemeProvider', () => {
    const { result } = renderHook(() => useOptionalTheme(), {
      wrapper: createWrapper({ themes: [lightTheme] }),
    });

    expect(result.current).toBeTruthy();
    expect(result.current?.theme?.name).toBe('light');
  });
});

// ============================================================================
// Theme switching
// ============================================================================

describe('Theme switching', () => {
  it('should switch theme via setTheme', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme, darkTheme], defaultTheme: 'light' }),
    });

    expect(result.current.activeTheme).toBe('light');

    act(() => {
      result.current.setTheme('dark');
    });

    expect(result.current.activeTheme).toBe('dark');
    expect(result.current.theme?.name).toBe('dark');
  });

  it('should not switch to nonexistent theme', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme], defaultTheme: 'light' }),
    });

    act(() => {
      result.current.setTheme('nonexistent');
    });

    expect(result.current.activeTheme).toBe('light');
  });

  it('should update CSS variables when theme changes', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme, darkTheme], defaultTheme: 'light' }),
    });

    const lightPrimary = result.current.cssVars['--primary'];

    act(() => {
      result.current.setTheme('dark');
    });

    const darkPrimary = result.current.cssVars['--primary'];
    expect(darkPrimary).not.toBe(lightPrimary);
  });
});

// ============================================================================
// Mode management
// ============================================================================

describe('Mode management', () => {
  it('should default mode to auto', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme] }),
    });

    expect(result.current.mode).toBe('auto');
  });

  it('should use defaultMode when provided', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme], defaultMode: 'dark' }),
    });

    expect(result.current.mode).toBe('dark');
    expect(result.current.resolvedMode).toBe('dark');
  });

  it('should switch mode via setMode', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme], defaultMode: 'light' }),
    });

    expect(result.current.resolvedMode).toBe('light');

    act(() => {
      result.current.setMode('dark');
    });

    expect(result.current.mode).toBe('dark');
    expect(result.current.resolvedMode).toBe('dark');
  });

  it('should resolve auto mode based on system preference', () => {
    // Mock system dark mode
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme], defaultMode: 'auto' }),
    });

    expect(result.current.resolvedMode).toBe('dark');

    window.matchMedia = original;
  });
});

// ============================================================================
// CSS variable injection
// ============================================================================

describe('CSS variable injection', () => {
  it('should inject CSS variables into documentElement', () => {
    renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme] }),
    });

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--primary')).toBeTruthy();
  });

  it('should inject mode class on documentElement', () => {
    renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme], defaultMode: 'dark' }),
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('should inject into custom target element', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme], target }),
    });

    expect(target.style.getPropertyValue('--primary')).toBeTruthy();

    document.body.removeChild(target);
  });

  it('should clean up CSS variables on unmount', () => {
    const { unmount } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme] }),
    });

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--primary')).toBeTruthy();

    unmount();

    expect(root.style.getPropertyValue('--primary')).toBe('');
  });

  it('should include typography and radius variables', () => {
    renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme] }),
    });

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--font-sans')).toBe('Inter, sans-serif');
    expect(root.style.getPropertyValue('--radius')).toBe('0.25rem');
    expect(root.style.getPropertyValue('--radius-lg')).toBe('0.5rem');
  });
});

// ============================================================================
// Theme inheritance
// ============================================================================

describe('Theme inheritance', () => {
  it('should resolve theme.extends', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({
        themes: [lightTheme, childTheme],
        defaultTheme: 'corporate',
      }),
    });

    // Child overrides primary
    expect(result.current.theme?.colors.primary).toBe('#1E40AF');
    // Inherits from parent
    expect(result.current.theme?.colors.secondary).toBe('#64748B');
    expect(result.current.theme?.colors.background).toBe('#FFFFFF');
    expect(result.current.theme?.typography?.fontFamily?.base).toBe('Inter, sans-serif');
  });
});

// ============================================================================
// Persistence
// ============================================================================

describe('Persistence', () => {
  it('should persist theme name to localStorage', () => {
    renderHook(() => useTheme(), {
      wrapper: createWrapper({
        themes: [lightTheme, darkTheme],
        defaultTheme: 'light',
        persist: true,
      }),
    });

    expect(localStorage.getItem('objectui-theme-name')).toBe('light');
  });

  it('should persist mode to localStorage', () => {
    renderHook(() => useTheme(), {
      wrapper: createWrapper({
        themes: [lightTheme],
        defaultMode: 'dark',
        persist: true,
      }),
    });

    expect(localStorage.getItem('objectui-theme-mode')).toBe('dark');
  });

  it('should restore theme from localStorage', () => {
    localStorage.setItem('objectui-theme-name', 'dark');
    localStorage.setItem('objectui-theme-mode', 'dark');

    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({
        themes: [lightTheme, darkTheme],
        defaultTheme: 'light',
        defaultMode: 'light',
        persist: true,
      }),
    });

    expect(result.current.activeTheme).toBe('dark');
    expect(result.current.mode).toBe('dark');
  });

  it('should use custom storageKey', () => {
    renderHook(() => useTheme(), {
      wrapper: createWrapper({
        themes: [lightTheme],
        persist: true,
        storageKey: 'myapp-theme',
      }),
    });

    expect(localStorage.getItem('myapp-theme-name')).toBe('light');
    expect(localStorage.getItem('myapp-theme-mode')).toBeTruthy();
  });

  it('should not persist when persist=false', () => {
    renderHook(() => useTheme(), {
      wrapper: createWrapper({
        themes: [lightTheme],
        persist: false,
      }),
    });

    expect(localStorage.getItem('objectui-theme-name')).toBeNull();
  });

  it('should update persistence when theme changes', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({
        themes: [lightTheme, darkTheme],
        defaultTheme: 'light',
        persist: true,
      }),
    });

    act(() => {
      result.current.setTheme('dark');
    });

    expect(localStorage.getItem('objectui-theme-name')).toBe('dark');
  });
});

// ============================================================================
// Generated CSS vars object
// ============================================================================

describe('cssVars output', () => {
  it('should expose cssVars in the context', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme] }),
    });

    expect(result.current.cssVars).toBeDefined();
    expect(result.current.cssVars['--primary']).toBeTruthy();
    expect(result.current.cssVars['--foreground']).toBeTruthy();
    expect(result.current.cssVars['--font-sans']).toBe('Inter, sans-serif');
  });

  it('should provide themes list', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper({ themes: [lightTheme, darkTheme] }),
    });

    expect(result.current.themes).toHaveLength(2);
    expect(result.current.themes[0].name).toBe('light');
    expect(result.current.themes[1].name).toBe('dark');
  });
});
