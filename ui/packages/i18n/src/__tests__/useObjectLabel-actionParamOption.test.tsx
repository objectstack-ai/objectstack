import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '../provider';
import { useObjectLabel } from '../useObjectLabel';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    I18nProvider,
    { config: { defaultLanguage: 'en', detectBrowserLanguage: false }, children },
  );

describe('useObjectLabel().actionParamOptionLabel', () => {
  it('is exposed and falls back to the provided label when untranslated', () => {
    const { result } = renderHook(() => useObjectLabel(), { wrapper });
    expect(result.current.actionParamOptionLabel).toBeTypeOf('function');
    // No translation registered for this option key → fallback (English literal).
    expect(
      result.current.actionParamOptionLabel('sys_environment', 'upgrade', 'plan', 'team', 'Team — $99/mo'),
    ).toBe('Team — $99/mo');
  });

  it('returns the fallback when action or param name is missing', () => {
    const { result } = renderHook(() => useObjectLabel(), { wrapper });
    expect(result.current.actionParamOptionLabel(undefined, undefined, 'plan', 'team', 'Team')).toBe('Team');
    expect(result.current.actionParamOptionLabel('sys_environment', 'upgrade', '', 'team', 'Team')).toBe('Team');
  });
});
