// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { buildPackageScopeOptions } from './package-scope';

describe('package-scope (ADR-0070)', () => {
  const raw = [
    { item: { manifest: { id: 'app.acme.crm', name: 'CRM', scope: 'project' } } },
    { item: { manifest: { id: 'platform.core', name: 'Core', scope: 'system' } } },
    { manifest: { id: 'app.acme.hr', name: 'HR', scope: 'project' } },
  ];

  it('returns only writable bases, sorted, with system/cloud filtered out', () => {
    const ids = buildPackageScopeOptions(raw).map((o) => o.id);
    expect(ids).toEqual(['app.acme.crm', 'app.acme.hr']); // sorted by name; no system
  });

  it('never offers a package-less "Local / Custom" scope (ADR-0070 D5 stopgap removed)', () => {
    const ids = buildPackageScopeOptions(raw).map((o) => o.id);
    expect(ids).not.toContain('sys_metadata');
    expect(ids.some((id) => !id)).toBe(false);
  });

  it('is empty when only code/installed packages exist (no orphan fallback)', () => {
    expect(buildPackageScopeOptions([{ manifest: { id: 'platform.core', scope: 'system' } }])).toEqual([]);
    expect(buildPackageScopeOptions(null)).toEqual([]);
  });
});
