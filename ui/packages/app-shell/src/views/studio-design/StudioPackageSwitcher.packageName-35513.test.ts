// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35513 — Studio's package switcher names a package that ships no
 * app by the package's name in the reader's language.
 *
 * The switcher names a package by its first served app where it publishes one
 * (ADR-0084 amendment, item 2); a package with no app of its own — HotCRM's
 * revenue module, which contributes to the Sales app — fell back to the
 * English `manifest.name` in every locale. `studioSwitcherRows` now takes the
 * namer (`useObjectLabel().packageName` in the component) for that rung.
 */

import { describe, it, expect } from 'vitest';
import { studioSwitcherRows, type ServedApp } from './StudioPackageSwitcher.js';
import type { PkgEntry } from './packages-io.js';

const pkg = (id: string, name: string): PkgEntry => ({ id, name, writable: true, namespace: 'hotcrm' });

const PKGS: PkgEntry[] = [
  pkg('com.hotcrm.sales', 'HotCRM'),
  pkg('com.hotcrm.revenue', 'HotCRM Revenue'),
];
const APPS: ServedApp[] = [
  { name: 'sales', label: '销售', _packageId: 'com.hotcrm.sales', active: true },
];
const zhNames: Record<string, string> = { 'com.hotcrm.revenue': '回款', 'com.hotcrm.sales': '销售套件' };
const namer = (p: { id: string; name?: string }) => zhNames[p.id] ?? p.name ?? p.id;

describe('studioSwitcherRows — the package name rung (objectstack#35513)', () => {
  it('names an app-less package by the translated package name', () => {
    const rows = studioSwitcherRows(PKGS, APPS, 'zh-CN', namer);
    expect(rows.find((r) => r.id === 'com.hotcrm.revenue')?.label).toBe('回款');
  });

  it('keeps naming a package by its app where it publishes one', () => {
    const rows = studioSwitcherRows(PKGS, APPS, 'zh-CN', namer);
    expect(rows.find((r) => r.id === 'com.hotcrm.sales')?.label).toBe('销售');
  });

  it('without a namer, an app-less package keeps its manifest name', () => {
    const rows = studioSwitcherRows(PKGS, APPS, 'zh-CN');
    expect(rows.find((r) => r.id === 'com.hotcrm.revenue')?.label).toBe('HotCRM Revenue');
  });
});
