// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { checkSpecVersionGap } from './spec-version.js';

describe('checkSpecVersionGap', () => {
  it('flags an app declaring an older major than the installed platform', () => {
    const gap = checkSpecVersionGap({ specVersion: '^12.0.0' }, '14.7.0');
    expect(gap).not.toBeNull();
    expect(gap!.declaredMajor).toBe(12);
    expect(gap!.installedMajor).toBe(14);
    expect(gap!.installedVersion).toBe('14.7.0');
    expect(gap!.url).toBe('https://objectstack.ai/docs/releases/v14');
    expect(gap!.hint).toContain('https://objectstack.ai/docs/releases/v14');
  });

  it('points at the guide for the INSTALLED major, not the declared one', () => {
    // Two-major jump (12 → 14): the guide must be v14, the version on disk.
    const gap = checkSpecVersionGap({ specVersion: '^12.0.0' }, '14.0.0');
    expect(gap!.url).toBe('https://objectstack.ai/docs/releases/v14');
  });

  it('is silent when declared major matches the installed platform', () => {
    expect(checkSpecVersionGap({ specVersion: '^14.0.0' }, '14.7.0')).toBeNull();
  });

  it('is silent when the app declares a NEWER major (stale install, out of scope)', () => {
    expect(checkSpecVersionGap({ specVersion: '^15.0.0' }, '14.7.0')).toBeNull();
  });

  it('is silent when no specVersion is declared', () => {
    expect(checkSpecVersionGap({}, '14.7.0')).toBeNull();
    expect(checkSpecVersionGap(undefined, '14.7.0')).toBeNull();
    expect(checkSpecVersionGap(null, '14.7.0')).toBeNull();
  });

  it('is silent when the installed version cannot be resolved', () => {
    expect(checkSpecVersionGap({ specVersion: '^12.0.0' }, null)).toBeNull();
  });

  it('parses the major out of assorted range spellings', () => {
    for (const range of ['^12.0.0', '>=12', '12.x', '~12.3.0', '12 || 13']) {
      const gap = checkSpecVersionGap({ specVersion: range }, '14.0.0');
      expect(gap, range).not.toBeNull();
      expect(gap!.declaredMajor, range).toBe(12);
    }
  });

  it('ignores a non-string specVersion', () => {
    expect(checkSpecVersionGap({ specVersion: 12 as unknown as string }, '14.0.0')).toBeNull();
  });
});
