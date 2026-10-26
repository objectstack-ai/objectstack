/**
 * Language-preference storage under SSR (objectstack#5406).
 *
 * This file is deliberately `.test.ts` so it lands in the `unit` project's
 * **node** environment — there is no `window` here for real, no stub involved.
 * That is the shape of a server render, and reading a preference must degrade
 * to "nothing stored" rather than throw and take the render down.
 */
import { describe, it, expect } from 'vitest';
import { LOCALE_STORAGE_KEY, readStoredLanguage } from '../provider';

describe('readStoredLanguage without a window (SSR)', () => {
  it('has no window in this environment', () => {
    expect(typeof window).toBe('undefined');
  });

  it('returns null instead of throwing', () => {
    expect(() => readStoredLanguage()).not.toThrow();
    expect(readStoredLanguage()).toBeNull();
  });

  it('exposes a stable storage key', () => {
    // The key is part of the package's public surface: apps clear it on sign
    // out and read it when they bootstrap their own i18next instance.
    expect(LOCALE_STORAGE_KEY).toBe('objectui-locale');
  });
});
