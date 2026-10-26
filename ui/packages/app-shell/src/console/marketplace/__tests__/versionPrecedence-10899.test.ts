// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SemVer 2.0.0 precedence behind the marketplace "update available" answer
 * (objectui#10899 item 7). The page-level consequence is pinned in
 * `MarketplacePackagePage.updateIsHigherVersion-10899.test.tsx`; this suite
 * pins the ordering itself against the spec's own §11 example chain.
 */

import { describe, it, expect } from 'vitest';
import { compareVersionPrecedence, isNewerVersion } from '../versionPrecedence';

describe('compareVersionPrecedence (SemVer 2.0.0 §11)', () => {
  it('orders the numeric core numerically, not as text', () => {
    expect(compareVersionPrecedence('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersionPrecedence('1.0.0', '1.1.0')).toBe(-1);
    expect(compareVersionPrecedence('2.0.0', '10.0.0')).toBe(-1);
    expect(compareVersionPrecedence('1.2.3', '1.2.3')).toBe(0);
  });

  it('follows the spec example chain 1.0.0-alpha < … < 1.0.0 end to end', () => {
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(compareVersionPrecedence(chain[i], chain[i + 1])).toBe(-1);
      expect(compareVersionPrecedence(chain[i + 1], chain[i])).toBe(1);
    }
  });

  it('ignores build metadata', () => {
    expect(compareVersionPrecedence('1.0.0+20230101', '1.0.0+build.9')).toBe(0);
  });

  it('answers null for a string that is not a SemVer version', () => {
    expect(compareVersionPrecedence('installed', '1.0.0')).toBeNull();
    expect(compareVersionPrecedence('1.0', '1.0.0')).toBeNull();
    expect(compareVersionPrecedence('v1.0.0', '1.0.0')).toBeNull();
    expect(compareVersionPrecedence('01.0.0', '1.0.0')).toBeNull();
  });
});

describe('isNewerVersion — the only condition that may offer an update', () => {
  it('is true only for a HIGHER version', () => {
    expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0-rc.1')).toBe(true);
  });

  it('is false for an older version — the reported `v1.1.0 → v1.0.0` case', () => {
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(false);
  });

  it('is false for an equal or incomparable pair', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', 'installed')).toBe(false);
  });
});
