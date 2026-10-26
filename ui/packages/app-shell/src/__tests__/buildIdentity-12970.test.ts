// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console's build identity is ONE read (objectui#12970): the help menu's
 * About dialog and Sentry's release fallback both go through
 * `resolveConsoleBuild`, so the two can never name different builds.
 *
 * Pinned through the pure readers because this repo's Vitest setup cannot put
 * a `VITE_*` value on `import.meta.env` (the same reason `resolveSentryGate`
 * is pure; see its header in `observability/sentry.ts`).
 */

import { describe, it, expect } from 'vitest';
import { resolveConsoleBuild, getConsoleBuild } from '../buildIdentity';
import { resolveSentryRelease } from '../observability/sentry';

describe('resolveConsoleBuild: the console build identity (objectui#12970)', () => {
  it('names the commit the build baked into VITE_APP_VERSION', () => {
    expect(resolveConsoleBuild({ VITE_APP_VERSION: '0707b4ae' })).toBe('0707b4ae');
  });

  it('trims surrounding whitespace from the baked value', () => {
    expect(resolveConsoleBuild({ VITE_APP_VERSION: '  0707b4ae\n' })).toBe('0707b4ae');
  });

  it.each<[string, unknown]>([
    ['absent', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', 42],
  ])('answers null when the value is %s, so the dialog states the fallback', (_label, value) => {
    expect(resolveConsoleBuild({ VITE_APP_VERSION: value })).toBeNull();
  });

  it('answers null for a missing env object', () => {
    expect(resolveConsoleBuild(undefined)).toBeNull();
    expect(resolveConsoleBuild(null)).toBeNull();
  });

  it('reads null under this test setup, which bakes no VITE_APP_VERSION', () => {
    expect(getConsoleBuild()).toBeNull();
  });
});

describe('resolveSentryRelease: falls back to the same build identity (objectui#12970)', () => {
  it('prefers an explicit VITE_SENTRY_RELEASE', () => {
    expect(resolveSentryRelease({ VITE_SENTRY_RELEASE: 'rel-1', VITE_APP_VERSION: '0707b4ae' })).toBe('rel-1');
  });

  it('falls back to the value resolveConsoleBuild reads, not a second spelling', () => {
    for (const env of [
      { VITE_APP_VERSION: '0707b4ae' },
      { VITE_APP_VERSION: '  0707b4ae ' },
      { VITE_SENTRY_RELEASE: '', VITE_APP_VERSION: 'be076dad' },
    ]) {
      expect(resolveSentryRelease(env)).toBe(resolveConsoleBuild(env));
    }
  });

  it("answers 'unknown' when the build named neither", () => {
    expect(resolveSentryRelease({})).toBe('unknown');
    expect(resolveSentryRelease({ VITE_SENTRY_RELEASE: ' ', VITE_APP_VERSION: '' })).toBe('unknown');
  });
});
